import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { SqliteD1Adapter } from '../../slice-c/test/sqlite-d1.mjs';
import {
  SAFE_NOTIFICATIONS,
  deliverNotification,
  evaluateReminder,
  getNotificationStatus,
  mondayWeekStart,
  normalizePushSubscription,
  runNotificationReminder,
  sendTestNotification,
  upsertPushSubscription,
} from '../src/notifications.mjs';

function createDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON; CREATE TABLE households(household_id TEXT PRIMARY KEY); INSERT INTO households VALUES(\'family\');');
  raw.exec(fs.readFileSync(new URL('../migrations/0004_web_push_notifications.sql', import.meta.url), 'utf8'));
  return { raw, db: new SqliteD1Adapter(raw) };
}

const env = {
  VAPID_PUBLIC_KEY: 'public',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:test@example.com',
};
const subscription = {
  endpoint: 'https://push.example/subscription/one',
  keys: { p256dh: 'Abc_123', auth: 'Def-456' },
};

test('subscription validation accepts only HTTPS and bounded base64url keys', () => {
  assert.deepEqual(normalizePushSubscription(subscription), subscription);
  assert.throws(() => normalizePushSubscription({ ...subscription, endpoint: 'http://push.example/a' }), /invalid/i);
  assert.throws(() => normalizePushSubscription({ ...subscription, keys: { p256dh: 'bad key', auth: 'ok' } }), /invalid/i);
});

test('subscriptions are attached to the authenticated actor and status does not expose endpoints', async () => {
  const { db, raw } = createDb();
  await upsertPushSubscription(db, 'ALEX@EXAMPLE.COM', subscription, { subscriptionId: 'sub-1', now: '2026-08-15T00:00:00Z' });
  const row = raw.prepare('SELECT actor_email,endpoint,disabled_at FROM push_subscriptions').get();
  assert.equal(row.actor_email, 'alex@example.com');
  assert.equal(row.endpoint, subscription.endpoint);
  const status = await getNotificationStatus(db, 'alex@example.com', env, { endpoint: subscription.endpoint });
  assert.equal(status.currentDeviceEnabled, true);
  assert.equal(status.actorEnabledCount, 1);
  assert.equal(JSON.stringify(status).includes(subscription.endpoint), false);
});

test('daily reminder ignores transaction-generated rows but accepts a real manual balance update', () => {
  const base = { balanceHistory: [{ business_date: '2026-08-15', one_off_payment_name: 'Transfer to EF', income_receipt_source: null }] };
  assert.equal(evaluateReminder(base, 'dailyBalance', '2026-08-15').due, true);
  base.balanceHistory.push({ business_date: '2026-08-15', one_off_payment_name: null, income_receipt_source: null });
  assert.equal(evaluateReminder(base, 'dailyBalance', '2026-08-15').due, false);
});

test('weekly EF reminder uses Monday week and the safe transfer engine result', () => {
  assert.equal(mondayWeekStart('2026-08-17'), '2026-08-17');
  assert.equal(mondayWeekStart('2026-08-23'), '2026-08-17');
  const snapshot = { ledger: [] };
  assert.equal(evaluateReminder(snapshot, 'weeklyEf', '2026-08-17', () => ({ guidanceAvailable: true, transferLimits: { emergencyFund: 100 } })).due, true);
  snapshot.ledger.push({ account: 'EF', direction: 'Contribution', business_date: '2026-08-17' });
  assert.equal(evaluateReminder(snapshot, 'weeklyEf', '2026-08-17', () => ({ guidanceAvailable: true, transferLimits: { emergencyFund: 100 } })).due, false);
});

test('delivery removes expired endpoints and never includes money in safe payloads', async () => {
  const { db, raw } = createDb();
  await upsertPushSubscription(db, 'alex@example.com', subscription, { subscriptionId: 'sub-1' });
  const sent = [];
  const result = await deliverNotification(db, env, SAFE_NOTIFICATIONS.dailyBalance, {
    sender: async (_sub, payload) => { sent.push(payload); const error = new Error('gone'); error.statusCode = 410; throw error; },
  });
  assert.deepEqual(result, { intended: 1, delivered: 0, failed: 1 });
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
  assert.equal(JSON.stringify(sent).includes('THB'), false);
});

test('test notification is limited to the current actor and endpoint', async () => {
  const { db } = createDb();
  await upsertPushSubscription(db, 'alex@example.com', subscription, { subscriptionId: 'sub-1' });
  const result = await sendTestNotification(db, 'alex@example.com', subscription.endpoint, env, { sender: async () => ({ statusCode: 201 }) });
  assert.equal(result.delivered, 1);
  await assert.rejects(() => sendTestNotification(db, 'olga@example.com', subscription.endpoint, env, { sender: async () => ({}) }), /not subscribed/i);
});

test('scheduled reminder writes one history row and deduplicates repeat execution', async () => {
  const { db, raw } = createDb();
  const options = {
    businessDate: '2026-08-15',
    snapshot: { balanceHistory: [] },
    notificationId: 'notice-1',
    now: '2026-08-15T13:00:00Z',
    sender: async () => ({ statusCode: 201 }),
  };
  const first = await runNotificationReminder(db, env, 'dailyBalance', options);
  const second = await runNotificationReminder(db, env, 'dailyBalance', { ...options, notificationId: 'notice-2' });
  assert.equal(first.sent, true);
  assert.equal(second.reason, 'duplicate');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM notification_history').get().n, 1);
});

test('in-app history still records a due reminder when push keys are unavailable', async () => {
  const { db, raw } = createDb();
  const result = await runNotificationReminder(db, {}, 'dailyBalance', {
    businessDate: '2026-08-16',
    snapshot: { balanceHistory: [] },
    notificationId: 'notice-no-keys',
    now: '2026-08-16T13:00:00Z',
  });
  assert.equal(result.sent, true);
  assert.equal(result.pushConfigured, false);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM notification_history').get().n, 1);
});

test('Android client assets expose opt-in, test delivery, history, and notification click handling', () => {
  const root = new URL('../../../', import.meta.url);
  const html = fs.readFileSync(new URL('index.html', root), 'utf8');
  const client = fs.readFileSync(new URL('assets/v24/v24_1_notifications.js', root), 'utf8');
  const worker = fs.readFileSync(new URL('sw.js', root), 'utf8');
  assert.match(html, /Enable on this device/);
  assert.match(html, /Recent reminders/);
  assert.match(client, /Notification\.requestPermission/);
  assert.match(client, /testNotification/);
  assert.match(worker, /self\.addEventListener\('push'/);
  assert.match(worker, /self\.addEventListener\('notificationclick'/);
});
