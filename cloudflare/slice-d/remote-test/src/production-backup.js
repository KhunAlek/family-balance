import { runPortableBackup } from '../../src/backup.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, productionBackupProof: true });
    if (request.method !== 'POST' || url.pathname !== '/backup') {
      return json({ ok: false, error: 'Not found.' }, 404);
    }
    try {
      return json(await runPortableBackup(env.DB, env.BACKUPS, {
        environment: 'production',
        retentionDays: 35,
        createdAt: new Date().toISOString(),
      }));
    } catch (error) {
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  },
};
