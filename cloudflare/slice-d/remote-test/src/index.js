import { runWeeklySnapshotJob } from '../../src/weekly-job.mjs';
import { runPortableBackup } from '../../src/backup.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, disposable: true });
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
    try {
      if (url.pathname === '/weekly') {
        return json(await runWeeklySnapshotJob(env.DB, {
          businessDate: '2026-08-17',
          nowIso: '2026-08-16T21:00:00.000Z',
          writeToken: 'slice-d-real-weekly-proof',
        }));
      }
      if (url.pathname === '/backup') {
        return json(await runPortableBackup(env.DB, env.BACKUPS, {
          environment: 'integration',
          retentionDays: 35,
          createdAt: '2026-08-14T20:00:00.000Z',
        }));
      }
      return json({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: 'slice_d_disposable_failure', message: String(error?.message || error) }));
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  },
};
