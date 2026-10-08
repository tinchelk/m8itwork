import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson, publishBackup, backupStep, due, runBounded, archivePattern } from '../agent.mjs';
import handler, { healthy, Monitor, transition, problems, DAY, MINUTE } from '../monitor/worker.mjs';

const archive = Buffer.concat([Buffer.from('M8BACK01'), Buffer.alloc(64)]);
test('failed and incomplete backups preserve prior successful archives; rotation owns only successful names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm8-ops-'));
  try {
    await writeFile(join(directory, 'other.enc'), 'keep');
    await writeFile(join(directory, 'unfinished.partial'), 'keep');
    for (let i = 1; i <= 14; i++) await publishBackup(directory, path => writeFile(path, archive), Date.UTC(2026, 8, i));
    const prior = (await readdir(directory)).sort();
    await assert.rejects(publishBackup(directory, async path => { await writeFile(path, archive); throw new Error('fail'); }));
    assert.deepEqual((await readdir(directory)).sort(), prior);
    await assert.rejects(publishBackup(directory, path => writeFile(path, 'invalid')));
    assert.deepEqual((await readdir(directory)).sort(), prior);
    await publishBackup(directory, path => writeFile(path, archive), Date.UTC(2026, 8, 15));
    const current = await readdir(directory);
    assert.equal(current.filter(name => archivePattern.test(name)).length, 14);
    assert(current.includes('other.enc')); assert(current.includes('unfinished.partial'));
    assert(!current.some(name => name.startsWith('m8itwork-2026-09-01')));
  } finally { await rm(directory, { recursive: true }); }
});
test('private durable state survives restart; scheduling catches up', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm8-state-'));
  try {
    const file = join(directory, 'state.json');
    await atomicJson(file, { snapshotAt: 1000 });
    const state = JSON.parse(await readFile(file, 'utf8'));
    assert(!due(state, 1000 + 19 * 3_600_000)); assert(due(state, 1000 + 20 * 3_600_000));
    assert(due({}, Date.now()));
    assert(due({snapshotAt:Date.now(),failed:true}, Date.now()));
  } finally { await rm(directory, { recursive: true }); }
});
test('backup tool failures and hangs are bounded', async () => {
  await assert.rejects(runBounded(process.execPath, ['-e', 'process.exit(3)'], {}, 2000));
  await assert.rejects(runBounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, 50));
});
test('post-publication state persistence failure preserves archives and retries instead of claiming fresh success', async () => {
  const directory=await mkdtemp(join(tmpdir(),'m8-persist-'));
  try {
    const old={snapshotAt:1000};
    const failed=await backupStep(directory,old,path=>writeFile(path,archive),2000,async()=>{throw new Error('disk full');});
    assert.equal(failed.snapshotAt,1000); assert.equal(failed.failed,true); assert(due(failed,2001));
    assert.equal((await readdir(directory)).filter(name=>archivePattern.test(name)).length,1);
    const recovered=await backupStep(directory,failed,path=>writeFile(path,archive),3000);
    assert.equal(recovered.failed,false); assert.equal(recovered.snapshotAt,3000);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'state.json'),'utf8')),recovered);
  } finally {await rm(directory,{recursive:true});}
});
test('HTTP, JSON, database/recovery and transport failures are unhealthy', async () => {
  for (const response of [new Response('{}'), new Response('oops'), Response.json({status:'ok',recovery:true}), Response.json({status:'ok',recovery:false},{status:500})])
    assert.equal(await healthy(async () => response), false);
  assert.equal(await healthy(async () => { throw new Error('offline'); }), false);
  assert.equal(await healthy(async (_url, options) => {
    assert.equal(options.redirect,'manual');
    return Response.json({status:'ok',recovery:false});
  }), true);
});
test('dead-man and backup freshness detect a sleeping/stopped host independently', () => {
  assert.deepEqual(problems({ apiFailures:2, heartbeatAt:MINUTE, snapshotAt:MINUTE }, MINUTE+DAY+1), {api:false,host:true,backup:true});
  assert.deepEqual(problems({ apiFailures:3, heartbeatAt:DAY, snapshotAt:DAY }, DAY), {api:true,host:false,backup:false});
});
test('stable failure and recovery episodes deduplicate repeated polls across restart', () => {
  let state = transition({}, {api:true}, 1000, () => 'one');
  state = JSON.parse(JSON.stringify(state));
  transition(state, {api:true}, 2000, () => 'two');
  assert.equal(state.outbox.length, 1); assert.equal(state.outbox[0].id,'one-failure');
  state.outbox[0].firstAttemptAt=2000;
  transition(state, {api:false}, 3000); transition(state, {api:false}, 4000);
  assert.equal(state.outbox.length, 2); assert.equal(state.outbox[1].id,'one-recovery');
});
test('a preflight failure that recovered before any delivery does not send stale outage mail', () => {
  const state=transition({}, {api:true}, 1000, ()=>'preflight');
  transition(state,{api:false},2000);
  assert.deepEqual(state.outbox,[]); assert.deepEqual(state.incidents,{});
});
function context() {
  let saved;
  return { storage: { get: async () => structuredClone(saved), put: async (_key, value) => {saved=structuredClone(value);} } };
}
const env = {HEARTBEAT_TOKEN:'test-only-token-which-is-long-enough',ALERTS_ENABLED:'true',RESEND_API_KEY:'synthetic',ALERT_TO:'synthetic@example.com',ALERT_FROM:'ops@example.com'};
function request(path, value, auth=env.HEARTBEAT_TOKEN) {
  if (path==='/heartbeat' && value && value.reportedAt===undefined) value={...value,reportedAt:Date.now()};
  return new Request(`https://monitor${path}`, {method:value?'POST':'GET',headers:{authorization:`Bearer ${auth}`},...(value?{body:JSON.stringify(value)}:{})});
}
test('public proxy refuses cron; heartbeat/status are protected and validate bounded timestamps', async () => {
  assert.equal((await handler.fetch(request('/tick'), {})).status, 404);
  const monitor = new Monitor(context(), env);
  assert.equal((await monitor.fetch(request('/status',null,'bad'))).status,401);
  assert.equal((await monitor.fetch(request('/heartbeat',{snapshotAt:Date.now()+DAY,backupFailed:false}))).status,400);
  assert.equal((await monitor.fetch(request('/heartbeat',{snapshotAt:Date.now(),backupFailed:false}))).status,200);
  assert.equal((await monitor.fetch(request('/status'))).status,200);
});
test('delayed old heartbeat cannot reverse a successful backup report', async () => {
  const monitor=new Monitor(context(),env), now=Date.now();
  await monitor.fetch(request('/heartbeat',{reportedAt:now,snapshotAt:now,backupFailed:false}));
  await monitor.fetch(request('/heartbeat',{reportedAt:now-100,snapshotAt:null,backupFailed:true}));
  const state=await monitor.ctx.storage.get('state');
  assert.equal(state.snapshotAt,now); assert.equal(state.backupFailed,false);
});
test('ambiguous delivery retries retain exact payload/key after restart; recovery is independent', async () => {
  const ctx = context(), original = globalThis.fetch, sent=[];
  let succeeds = false;
  globalThis.fetch = async (url, init) => {
    if (url.includes('/health')) return Response.json({status:'ok',recovery:false});
    sent.push({key:init.headers['idempotency-key'],body:init.body});
    if (!succeeds) throw new Error('reply lost');
    return Response.json({id:'provider-email-id'});
  };
  try {
    let monitor = new Monitor(ctx, env);
    await monitor.fetch(request('/heartbeat',{snapshotAt:Date.now(),backupFailed:false}));
    await monitor.fetch(request('/probe',{})); await monitor.tick();
    monitor = new Monitor(ctx, {...env,ALERT_TO:'changed@example.com'});
    succeeds=true; await monitor.tick();
    assert.deepEqual(sent[0],sent[1]);
    assert.equal(sent.length,3); assert.notEqual(sent[1].key,sent[2].key);
    assert.equal((await (await monitor.fetch(request('/status'))).json()).pendingAlerts,0);
  } finally { globalThis.fetch=original; }
});
test('ambiguous alerts beyond provider retention fail closed without sending a replacement', async () => {
  const ctx=context(), original=globalThis.fetch;
  await ctx.storage.put('state',{heartbeatAt:Date.now(),snapshotAt:Date.now(),incidents:{},outbox:[{id:'old-failure',kind:'api',createdAt:1,firstAttemptAt:Date.now()-DAY}]});
  globalThis.fetch=async url => {assert(url.endsWith('/health'));return Response.json({status:'ok',recovery:false});};
  try {
    const monitor=new Monitor(ctx,env); await monitor.tick();
    const status=await (await monitor.fetch(request('/status'))).json();
    assert.deepEqual(status.uncertainAlerts,['old-failure']); assert.equal(status.pendingAlerts,0);
  } finally {globalThis.fetch=original;}
});
