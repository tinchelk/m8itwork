import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const image = process.env.WORKER_IMAGE ?? "m8itwork-review-worker:local";
const tests = fileURLToPath(new URL(".", import.meta.url));
function docker(...args) { return spawnSync("docker", args, { encoding: "utf8", timeout: 45_000 }); }
function ok(result) { assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-1800)); return result.stdout.trim(); }
const flags = ["--init", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--tmpfs=/tmp:rw,noexec,nosuid,size=128m,mode=1777"];
function fixture(volume, mode, extra = ["--rm"]) {
  const named = extra.indexOf("--name"), name = named < 0 ? `m8-worker-fixture-${randomUUID()}` : extra[named + 1];
  const detached = extra.includes("-d");
  ok(docker("create", ...(detached ? [] : ["--rm"]), "--name", name, ...flags, "--volume", `${volume}:/home/node`, "--entrypoint", "node", image, "/home/node/container-fixture.mjs", mode));
  // Copy synthetic test data through Docker; no host filesystem mount is needed.
  ok(docker("cp", `${tests}/fixture.mjs`, `${name}:/home/node/container-fixture.mjs`));
  return docker("start", ...(detached ? [] : ["--attach"]), name);
}
async function until(predicate) { const deadline = Date.now() + 15_000; while (Date.now() < deadline) { if (predicate()) return; await new Promise(r => setTimeout(r, 200)); } throw new Error("Container condition timed out"); }
function volume(t) { const name = `m8-worker-test-${randomUUID()}`; ok(docker("volume", "create", name)); t.after(() => { const containers = ok(docker("ps", "--all", "--quiet", "--filter", `volume=${name}`)); if (containers) ok(docker("rm", "--force", ...containers.split("\n"))); ok(docker("volume", "rm", name)); }); return name; }
test("image is non-root, versioned and has no API runtime or exposed ports", t => {
  const config = JSON.parse(ok(docker("image", "inspect", image)))[0].Config;
  assert.equal(config.User, "node"); assert.equal(config.ExposedPorts, undefined);
  const versions = ok(docker("run", "--rm", ...flags, "-v", `${volume(t)}:/home/node`, image, "versions"));
  assert.match(versions, /v22\./); assert.match(versions, /0\.160\.1/); assert.match(versions, /2\.1\.290/);
  ok(docker("run", "--rm", "--entrypoint", "sh", image, "-c", "test ! -e /app/dist/server.js && test ! -e /app/.env && test ! -d /app/node_modules/@prisma"));
});
test("pairing persists privately and invalid configuration does not reveal its content", t => {
  const v = volume(t), secret = "x".repeat(43);
  const config = JSON.stringify({ apiUrl: "https://example.invalid/", token: secret, providers: ["codex"] });
  const paired = spawnSync("docker", ["run", "--rm", "-i", ...flags, "-v", `${v}:/home/node`, image, "configure"], { input: config, encoding: "utf8", timeout: 45_000 }); ok(paired); assert.ok(!paired.stdout.includes(secret));
  ok(docker("run", "--rm", "-v", `${v}:/home/node`, "--entrypoint", "node", image, "-e", "const fs=require('fs'); const p='/home/node/.m8itwork/worker.json'; if((fs.statSync(p).mode&0o777)!==0o600)process.exit(1); if(!JSON.parse(fs.readFileSync(p)).token)process.exit(1)"));
  const invalid = spawnSync("docker", ["run", "--rm", "-i", ...flags, "-v", `${v}:/home/node`, image, "configure"], { input: '{"token":"private-invalid-fixture"}', encoding: "utf8", timeout: 45_000 }); assert.notEqual(invalid.status, 0); assert.ok(!(invalid.stdout + invalid.stderr).includes("private-invalid-fixture"));
});
test("fresh subscription status is reported and synthetic queue completes privately", t => {
  const v = volume(t); assert.match(ok(fixture(v, "unauth")), /reported without claiming/); assert.match(ok(fixture(v, "unauth-claude")), /reported without claiming/); assert.match(ok(fixture(v, "review")), /validated private reply passed/);
});
test("provider errors and quota cooldown are visible without billing fallback", t => {
  const v = volume(t); assert.match(ok(fixture(v, "broken")), /Provider error reported/);
  assert.match(ok(fixture(v, "quota")), /Quota cooldown recorded/);
  assert.match(ok(fixture(v, "cooldown")), /cooldown survives container recreation/);
});
test("shared volume rejects a duplicate container and recovers after SIGKILL", async t => {
  const v = volume(t), name = `m8-worker-lock-${randomUUID()}`;
  t.after(() => docker("rm", "-f", name));
  ok(fixture(v, "idle", ["-d", "--name", name]));
  await until(() => docker("logs", name).stdout.includes("Fixture worker ready."));
  const duplicate = docker("run", "--rm", ...flags, "-v", `${v}:/home/node`, image, "run"); assert.equal(duplicate.status, 75);
  ok(docker("kill", "--signal=KILL", name)); ok(docker("rm", name));
  assert.match(ok(fixture(v, "empty")), /Stale PID recovery passed/);
});
test("Docker stop cancels an active provider and exits gracefully", async t => {
  const v = volume(t), name = `m8-worker-stop-${randomUUID()}`;
  t.after(() => docker("rm", "-f", name));
  ok(fixture(v, "long", ["-d", "--name", name]));
  await until(() => docker("exec", name, "test", "-f", "/home/node/.model-pid").status === 0);
  ok(docker("stop", "--time=10", name));
  const info = JSON.parse(ok(docker("inspect", name)))[0]; assert.equal(info.State.ExitCode, 0);
  assert.match(ok(docker("logs", name)), /Active provider process stopped cleanly/);
  ok(docker("rm", name));
});
test("remote Codex reconnect relays only the device prompt and handles cancellation/failure", t => {
  for (const mode of ["reconnect-success", "reconnect-cancel", "reconnect-failed"]) {
    const output = ok(fixture(volume(t), mode)); assert.match(output, /Remote reconnect lifecycle passed/); assert.ok(!output.includes("fabricated-auth-credential")); assert.ok(!output.includes("ABCD-EF123"));
  }
});
