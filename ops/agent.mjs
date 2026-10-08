import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, readFile, readdir, rename, unlink, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const archivePattern = /^m8itwork-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.enc$/;
export async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.partial`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
  const directory = await open(resolve(file, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function runBounded(command, args, env, timeoutMs = 600_000) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, { env, stdio: 'ignore', detached: true });
    let timedOut = false, killTimer;
    function terminate(signal) { try { process.kill(-child.pid, signal); } catch {} }
    const timer = setTimeout(() => {
      timedOut = true; terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), 2_000);
    }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); clearTimeout(killTimer); fail(new Error('BACKUP_TOOL_FAILED')); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (code === 0 && !timedOut) ok(); else fail(new Error('BACKUP_TOOL_FAILED'));
    });
  });
}
export async function publishBackup(directory, execute, now = Date.now()) {
  const filename = `m8itwork-${new Date(now).toISOString().replaceAll(':', '-').replace('.', '-')}-${randomUUID()}.enc`;
  const file = join(directory, filename), partial = `${file}.partial`;
  try {
    await execute(partial);
    const handle = await open(partial, 'r');
    try {
      const info = await handle.stat(), header = Buffer.alloc(8);
      await handle.read(header, 0, 8, 0);
      if (!info.isFile() || info.size < 36 || header.toString() !== 'M8BACK01') throw new Error('INVALID_BACKUP');
      await handle.sync();
    } finally { await handle.close(); }
    await rename(partial, file);
    const folder = await open(directory, 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  } catch (error) { await unlink(partial).catch(() => {}); throw error; }
  // Only prune this agent's completed files, after a new durable copy exists.
  const names = (await readdir(directory)).filter(name => archivePattern.test(name)).sort().reverse();
  for (const name of names.slice(14)) {
    if ((await stat(join(directory, name))).isFile()) await unlink(join(directory, name));
  }
  return { snapshotAt: now, file: filename };
}
export function due(state, now) {
  return state.failed || !state.snapshotAt || now - state.snapshotAt >= 20 * 3_600_000;
}
export async function backupStep(directory, previous, execute, now = Date.now(), persist = atomicJson) {
  try {
    const result = await publishBackup(directory, execute, now);
    const next = { ...result, failed: false };
    await persist(join(directory, 'state.json'), next);
    return next;
  } catch {
    const failed = { ...previous, failed: true };
    await persist(join(directory, 'state.json'), failed).catch(() => {});
    return failed;
  }
}
export async function main() {
  process.umask(0o077);
  const config = JSON.parse(await readFile('/run/secrets/ops.json', 'utf8'));
  const source = new URL(config.databaseUrl), monitor = new URL(config.monitorUrl);
  if (!['verify-ca', 'verify-full'].includes(source.searchParams.get('sslmode')) || !config.databaseCa || monitor.protocol !== 'https:' ||
      Buffer.from(config.encryptionKey ?? '', 'base64').length !== 32 || (config.heartbeatToken ?? '').length < 32)
    throw new Error('OPS_CONFIGURATION_INVALID');
  const directory = '/backups';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ca = await open('/tmp/database-ca.pem', 'wx', 0o600);
  try { await ca.writeFile(config.databaseCa); } finally { await ca.close(); }
  let state = {};
  try { state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('OPS_STATE_INVALID'); }
  if (state.snapshotAt && (!Number.isFinite(state.snapshotAt) || state.snapshotAt > Date.now())) throw new Error('OPS_STATE_INVALID');
  let running = false, stopping = false, nextAttempt = 0, task = Promise.resolve();
  let heartbeatQueue = Promise.resolve(), lastReportedAt = 0;
  const heartbeat = () => {
    heartbeatQueue = heartbeatQueue.then(async () => {
    try {
      lastReportedAt = Math.max(Date.now(), lastReportedAt + 1);
      const response = await fetch(new URL('/heartbeat', monitor), {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${config.heartbeatToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reportedAt: lastReportedAt, snapshotAt: state.snapshotAt ?? null, backupFailed: Boolean(state.failed) }),
      });
      if (!response.ok) throw new Error('HEARTBEAT_FAILED');
    } catch { console.error('HEARTBEAT_FAILED'); }
    });
    return heartbeatQueue;
  };
  const tick = async () => {
    if (stopping) return;
    if (!running && due(state, Date.now()) && Date.now() >= nextAttempt) {
      running = true;
      task = (async () => {
        try {
          state = await backupStep(directory, state, path => runBounded('/usr/local/bin/node',
            ['/app/backup.ts', 'backup', path], {
              PATH: process.env.PATH, BACKUP_DATABASE_URL: config.databaseUrl,
              BACKUP_ENCRYPTION_KEY: config.encryptionKey, HOME: '/tmp',
              PGSSLROOTCERT: '/tmp/database-ca.pem', PGCONNECT_TIMEOUT: '10',
            }));
          console.log(state.failed ? 'BACKUP_FAILED' : 'BACKUP_COMPLETED');
        } catch {
          state = { ...state, failed: true };
          await atomicJson(join(directory, 'state.json'), state).catch(() => {});
          console.error('BACKUP_FAILED');
        } finally { nextAttempt = Date.now() + 3_600_000; running = false; }
        await heartbeat();
      })();
    }
    await heartbeat();
  };
  await tick();
  let heartbeatRunning = false;
  const interval = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    void tick().finally(() => { heartbeatRunning = false; });
  }, 60_000);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    stopping = true; clearInterval(interval);
    void task.finally(() => process.exit(0));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error('OPS_CONFIGURATION_OR_STORAGE_FAILED'); process.exitCode = 2; });
