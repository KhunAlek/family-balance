import { loadFinancialSnapshot } from '../../slice-b/src/d1-repository.mjs';
import { buildDashboardReadModel } from '../../slice-b/src/read-model.mjs';
import { bangkokBusinessDate } from './weekly-job.mjs';

const HOUSEHOLD_ID = 'family';
const MAX_ENDPOINT_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const DAILY_BALANCE_CRON = '0 13 * * *';
export const WEEKLY_EF_CRON = '0 2 * * MON';

export const SAFE_NOTIFICATIONS = Object.freeze({
  dailyBalance: Object.freeze({
    kind: 'daily_balance',
    title: 'Family Cash Flow: Balance update needed',
    body: 'No manual balance update has been recorded today. Open the app to update Alex, Olga, or both.',
    actionUrl: '/?notification=daily_balance',
  }),
  weeklyEf: Object.freeze({
    kind: 'weekly_ef',
    title: 'Family Cash Flow: EF action available',
    body: 'Open the app to review this week\'s Emergency Fund transfer.',
    actionUrl: '/?notification=weekly_ef',
  }),
  test: Object.freeze({
    kind: 'test',
    title: 'Family Cash Flow: Test notification',
    body: 'Notifications are working on this device.',
    actionUrl: '/?notification=test',
  }),
});

function nowIso(value) {
  return new Date(value ?? Date.now()).toISOString();
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanBase64Url(value, label) {
  const text = String(value || '').trim();
  if (!text || text.length > 512 || !BASE64URL.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

export function normalizePushSubscription(input) {
  const endpoint = String(input?.endpoint || '').trim();
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Push subscription endpoint is invalid.'); }
  if (url.protocol !== 'https:' || endpoint.length > MAX_ENDPOINT_LENGTH) throw new Error('Push subscription endpoint is invalid.');
  return {
    endpoint,
    keys: {
      p256dh: cleanBase64Url(input?.keys?.p256dh, 'Push encryption key'),
      auth: cleanBase64Url(input?.keys?.auth, 'Push authentication key'),
    },
  };
}

async function selectRows(db, statement) {
  const result = await db.batch([statement]);
  return result[0]?.results || [];
}

export async function upsertPushSubscription(db, identityEmail, input, options = {}) {
  const subscription = normalizePushSubscription(input);
  const timestamp = nowIso(options.now);
  await db.prepare(
    `INSERT INTO push_subscriptions(
      subscription_id,household_id,actor_email,endpoint,p256dh,auth,user_agent,created_at,updated_at,
      last_success_at,last_error_at,consecutive_failures,disabled_at
    ) VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,0,NULL)
    ON CONFLICT(endpoint) DO UPDATE SET
      household_id=excluded.household_id,
      actor_email=excluded.actor_email,
      p256dh=excluded.p256dh,
      auth=excluded.auth,
      user_agent=excluded.user_agent,
      updated_at=excluded.updated_at,
      consecutive_failures=0,
      disabled_at=NULL`
  ).bind(
    options.subscriptionId || crypto.randomUUID(),
    options.householdId || HOUSEHOLD_ID,
    cleanEmail(identityEmail),
    subscription.endpoint,
    subscription.keys.p256dh,
    subscription.keys.auth,
    String(options.userAgent || '').slice(0, 512) || null,
    timestamp,
    timestamp
  ).run();
  return { ok: true, enabled: true };
}

export async function removePushSubscription(db, identityEmail, endpoint, householdId = HOUSEHOLD_ID) {
  const normalized = normalizePushSubscription({ endpoint, keys: { p256dh: 'A', auth: 'A' } }).endpoint;
  await db.prepare('DELETE FROM push_subscriptions WHERE household_id=? AND actor_email=? AND endpoint=?')
    .bind(householdId, cleanEmail(identityEmail), normalized).run();
  return { ok: true, enabled: false };
}

export async function getNotificationStatus(db, identityEmail, env, options = {}) {
  const householdId = options.householdId || HOUSEHOLD_ID;
  const endpoint = String(options.endpoint || '').trim();
  const rows = await selectRows(db, db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM push_subscriptions WHERE household_id=? AND actor_email=? AND disabled_at IS NULL) AS actor_enabled_count,
       (SELECT COUNT(*) FROM push_subscriptions WHERE household_id=? AND actor_email=? AND endpoint=? AND disabled_at IS NULL) AS current_device_enabled`
  ).bind(householdId, cleanEmail(identityEmail), householdId, cleanEmail(identityEmail), endpoint));
  const history = await selectRows(db, db.prepare(
    `SELECT notification_id,kind,title,body,action_url,business_date,created_at,delivered_count,failed_count
       FROM notification_history WHERE household_id=? ORDER BY created_at DESC LIMIT 20`
  ).bind(householdId));
  const status = rows[0] || {};
  return {
    ok: true,
    supported: true,
    configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
    vapidPublicKey: String(env.VAPID_PUBLIC_KEY || ''),
    actorEnabledCount: Number(status.actor_enabled_count || 0),
    currentDeviceEnabled: Number(status.current_device_enabled || 0) > 0,
    history: history.map(row => ({
      id: row.notification_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      actionUrl: row.action_url,
      businessDate: row.business_date,
      createdAt: row.created_at,
      deliveredCount: Number(row.delivered_count || 0),
      failedCount: Number(row.failed_count || 0),
    })),
  };
}

async function defaultPushSender(subscription, payload, env, topic) {
  const { sendNotification } = await import('web-push-neo');
  return sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
    TTL: 3600,
    urgency: 'normal',
    topic: String(topic || 'family-cash-flow').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32),
    signal: AbortSignal.timeout(10000),
  });
}

function pushPayload(notification) {
  return {
    title: notification.title,
    body: notification.body,
    tag: `family-cash-flow-${notification.kind}`,
    actionUrl: notification.actionUrl || '/',
  };
}

export async function deliverNotification(db, env, notification, options = {}) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error('Web Push is not configured.');
  const householdId = options.householdId || HOUSEHOLD_ID;
  const actorEmail = options.actorEmail ? cleanEmail(options.actorEmail) : null;
  const endpoint = options.endpoint ? String(options.endpoint).trim() : null;
  let sql = `SELECT subscription_id,actor_email,endpoint,p256dh,auth
               FROM push_subscriptions WHERE household_id=? AND disabled_at IS NULL`;
  const params = [householdId];
  if (actorEmail) { sql += ' AND actor_email=?'; params.push(actorEmail); }
  if (endpoint) { sql += ' AND endpoint=?'; params.push(endpoint); }
  const subscriptions = await selectRows(db, db.prepare(sql).bind(...params));
  const sender = options.sender || defaultPushSender;
  let delivered = 0;
  let failed = 0;
  const timestamp = nowIso(options.now);
  for (const row of subscriptions) {
    try {
      await sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, pushPayload(notification), env, notification.kind);
      delivered += 1;
      await db.prepare('UPDATE push_subscriptions SET last_success_at=?,last_error_at=NULL,consecutive_failures=0 WHERE subscription_id=?')
        .bind(timestamp, row.subscription_id).run();
    } catch (error) {
      failed += 1;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 404 || statusCode === 410) {
        await db.prepare('DELETE FROM push_subscriptions WHERE subscription_id=?').bind(row.subscription_id).run();
      } else {
        await db.prepare('UPDATE push_subscriptions SET last_error_at=?,consecutive_failures=consecutive_failures+1 WHERE subscription_id=?')
          .bind(timestamp, row.subscription_id).run();
      }
      console.warn(JSON.stringify({ event: 'web_push_delivery_failed', kind: notification.kind, statusCode: statusCode || null }));
    }
  }
  return { intended: subscriptions.length, delivered, failed };
}

export async function sendTestNotification(db, identityEmail, endpoint, env, options = {}) {
  const normalizedEndpoint = normalizePushSubscription({ endpoint, keys: { p256dh: 'A', auth: 'A' } }).endpoint;
  const result = await deliverNotification(db, env, SAFE_NOTIFICATIONS.test, {
    ...options,
    actorEmail: identityEmail,
    endpoint: normalizedEndpoint,
  });
  if (result.intended !== 1) throw new Error('This device is not subscribed. Enable notifications first.');
  if (result.delivered !== 1) throw new Error('The test notification could not be delivered.');
  return { ok: true, ...result };
}

function hasManualBalanceForDate(snapshot, businessDate) {
  return (snapshot.balanceHistory || []).some(row =>
    row.business_date === businessDate &&
    !String(row.one_off_payment_name || '').trim() &&
    !String(row.income_receipt_source || '').trim()
  );
}

export function mondayWeekStart(businessDate) {
  const date = new Date(`${businessDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Business date is invalid.');
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function hasEfContributionThisWeek(snapshot, businessDate) {
  const weekStart = mondayWeekStart(businessDate);
  return (snapshot.ledger || []).some(row =>
    row.account === 'EF' && row.direction === 'Contribution' &&
    row.business_date >= weekStart && row.business_date <= businessDate
  );
}

export function evaluateReminder(snapshot, kind, businessDate, modelBuilder = buildDashboardReadModel) {
  if (kind === 'dailyBalance') {
    return { due: !hasManualBalanceForDate(snapshot, businessDate), notification: SAFE_NOTIFICATIONS.dailyBalance };
  }
  if (kind === 'weeklyEf') {
    if (hasEfContributionThisWeek(snapshot, businessDate)) return { due: false, reason: 'already_recorded' };
    const model = modelBuilder(snapshot, businessDate);
    const safeAmount = Number(model?.transferLimits?.emergencyFund || 0);
    return {
      due: !!model?.guidanceAvailable && safeAmount > 0,
      reason: model?.guidanceAvailable ? (safeAmount > 0 ? 'available' : 'not_available') : 'guidance_unavailable',
      notification: SAFE_NOTIFICATIONS.weeklyEf,
    };
  }
  throw new Error(`Unknown reminder kind: ${kind}`);
}

async function createHistoryOnce(db, notification, businessDate, options = {}) {
  const notificationId = options.notificationId || crypto.randomUUID();
  const dedupeKey = `${options.householdId || HOUSEHOLD_ID}:${notification.kind}:${businessDate}`;
  const result = await db.prepare(
    `INSERT OR IGNORE INTO notification_history(
       notification_id,household_id,kind,title,body,action_url,business_date,dedupe_key,created_at
     ) VALUES(?,?,?,?,?,?,?,?,?)`
  ).bind(
    notificationId,
    options.householdId || HOUSEHOLD_ID,
    notification.kind,
    notification.title,
    notification.body,
    notification.actionUrl || '/',
    businessDate,
    dedupeKey,
    nowIso(options.now)
  ).run();
  return Number(result?.meta?.changes || 0) > 0 ? notificationId : null;
}

export async function runNotificationReminder(db, env, kind, options = {}) {
  const businessDate = options.businessDate || bangkokBusinessDate(options.scheduledTime);
  const snapshot = options.snapshot || await (options.loadSnapshot || loadFinancialSnapshot)(db, options.householdId || HOUSEHOLD_ID);
  const decision = evaluateReminder(snapshot, kind, businessDate, options.modelBuilder || buildDashboardReadModel);
  if (!decision.due) return { ok: true, kind, businessDate, sent: false, reason: decision.reason || 'not_due' };
  const notificationId = await createHistoryOnce(db, decision.notification, businessDate, options);
  if (!notificationId) return { ok: true, kind, businessDate, sent: false, reason: 'duplicate' };
  const pushConfigured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  const delivery = pushConfigured
    ? await deliverNotification(db, env, decision.notification, options)
    : { intended: 0, delivered: 0, failed: 0 };
  await db.prepare(
    'UPDATE notification_history SET intended_count=?,delivered_count=?,failed_count=? WHERE notification_id=?'
  ).bind(delivery.intended, delivery.delivered, delivery.failed, notificationId).run();
  return { ok: true, kind, businessDate, sent: true, pushConfigured, ...delivery };
}

export async function handleNotificationAction(payload, identity, env, options = {}) {
  const action = String(payload?.apiAction || '');
  const body = payload?.payload || {};
  if (action === 'notificationStatus') return getNotificationStatus(env.DB, identity.email, env, { endpoint: body.endpoint });
  if (action === 'subscribeNotifications') return upsertPushSubscription(env.DB, identity.email, body.subscription, {
    userAgent: options.userAgent,
  });
  if (action === 'unsubscribeNotifications') return removePushSubscription(env.DB, identity.email, body.endpoint);
  if (action === 'testNotification') return sendTestNotification(env.DB, identity.email, body.endpoint, env, options);
  return null;
}
