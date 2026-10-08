import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const image=process.env.OPS_TEST_IMAGE??'m8itwork-operations:local';
test('portable backup image uses Node22/PostgreSQL18 and only dedicated private mounts',()=>{
  const value=JSON.parse(execFileSync('docker',['compose','-f','compose.ops.yml','config','--format','json'],{env:{...process.env,M8_OPS_CONFIG:'/tmp/synthetic-ops.json',M8_BACKUP_DIRECTORY:'/tmp/synthetic-backups'},encoding:'utf8'}));
  const service=value.services.backup;
  assert.equal(service.user,'10001:10001'); assert.equal(service.read_only,true);
  assert.deepEqual(service.cap_drop,['ALL']); assert(service.security_opt.includes('no-new-privileges:true'));
  assert.equal(service.ports,undefined); assert.equal(service.volumes.length,2);
  assert.deepEqual(service.tmpfs,['/tmp:rw,noexec,nosuid,size=16m,mode=1777']);
  assert(!service.volumes.some(x=>x.target.includes('docker.sock')||x.target.includes('worker')));
  const versions=execFileSync('docker',['run','--rm','--network','none','--read-only','--entrypoint','sh',image,'-c','node --version; pg_dump --version'],{encoding:'utf8'});
  assert.match(versions,/v22\./); assert.match(versions,/pg_dump.*18\./);
});
test('OS lock prevents a second backup process and releases after a crash',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'m8-ops-lock-'));
  await chmod(directory,0o777);
  const mount=['--mount',`type=bind,src=${directory},dst=/backups`];
  let id;
  try {
    id=execFileSync('docker',['run','--rm','-d','--network','none','--read-only','--cap-drop=ALL',...mount,'--entrypoint','flock',image,'--nonblock','--no-fork','/backups/.operations.lock','node','-e','setInterval(()=>{},1000)'],{encoding:'utf8'}).trim();
    // Docker run returns after the first process starts; inspect its active lock via flock retry only if startup has not acquired it yet.
    let denied=false;
    for(let i=0;i<10;i++) {
      const other=spawnSync('docker',['run','--rm','--network','none','--read-only',...mount,'--entrypoint','flock',image,'--nonblock','--no-fork','/backups/.operations.lock','node','-e','console.log("entered")'],{encoding:'utf8'});
      if(other.status===1) {denied=true;break;}
    }
    assert(denied);
    execFileSync('docker',['kill',id],{stdio:'ignore'}); id=undefined;
    const acquired=execFileSync('docker',['run','--rm','--network','none','--read-only',...mount,'--entrypoint','flock',image,'--nonblock','--no-fork','/backups/.operations.lock','node','-e','console.log("entered")'],{encoding:'utf8'});
    assert.equal(acquired.trim(),'entered');
  } finally {if(id)spawnSync('docker',['kill',id],{stdio:'ignore'});await rm(directory,{recursive:true,force:true});}
});
