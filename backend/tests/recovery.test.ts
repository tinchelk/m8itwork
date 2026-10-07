import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyRecoveryMerchant } from "../src/recovery.js";

const exec = promisify(execFile);
describe("recovery identity and encrypted archive integrity", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "m8-recovery-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("rejects another merchant or mode even before any restored payment exists", () => {
    const expected = { accountId: "acct_original", mode: "test" };
    expect(() =>
      verifyRecoveryMerchant(expected, "acct_original", {
        accountId: "acct_other",
        mode: "test",
      }),
    ).toThrow("RECOVERY_MERCHANT_MISMATCH");
    expect(() =>
      verifyRecoveryMerchant(expected, "acct_original", {
        accountId: "acct_original",
        mode: "live",
      }),
    ).toThrow();
    expect(() => verifyRecoveryMerchant(expected, "", expected)).toThrow();
    expect(() =>
      verifyRecoveryMerchant(expected, "acct_original", expected),
    ).not.toThrow();
  });
  it("never deletes a prior archive, authenticates before restore, and redacts invalid URL configuration", async () => {
    const archive = join(dir, "archive.enc"),
      marker = join(dir, "restore-called"),
      fake = join(dir, "pg.cjs");
    await writeFile(
      fake,
      `if(process.argv[2]==='pg_dump') process.stdout.write('synthetic archive'); else {require('fs').writeFileSync(${JSON.stringify(marker)}, 'invoked');process.stdin.resume();}`,
    );
    const env = {
      ...process.env,
      BACKUP_DATABASE_URL: "postgresql://fixture:private@127.0.0.1/source",
      RECOVERY_DATABASE_URL:
        "postgresql://fixture:private@127.0.0.1/m8itwork_restore_fixture",
      BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      PG_TOOL_PREFIX: JSON.stringify([process.execPath, fake]),
    };
    const run = (mode: string, extras = {}) =>
      exec(
        process.execPath,
        ["--import", "tsx", "scripts/backup.ts", mode, archive],
        { env: { ...env, ...extras } },
      );
    await run("backup");
    const before = await readFile(archive);
    expect((await stat(archive)).mode & 0o777).toBe(0o600);
    await expect(run("backup")).rejects.toMatchObject({ code: 2 });
    expect(await readFile(archive)).toEqual(before);
    const corrupt = Buffer.from(before);
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    await writeFile(archive, corrupt);
    await expect(run("restore")).rejects.toMatchObject({ code: 2 });
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    try {
      await run("backup", {
        BACKUP_DATABASE_URL: "postgresql://secret-password@invalid url",
      });
      throw new Error("Expected rejection");
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string };
      expect(`${output.stdout}${output.stderr}`).not.toContain(
        "secret-password",
      );
    }
    await writeFile(archive, before);
    await run("restore");
    expect(await readFile(marker, "utf8")).toBe("invoked");
  });
});
