import "dotenv/config";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, open, unlink } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";

// No database URL/password enters argv or diagnostic output. PG_TOOL_PREFIX may
// be ["docker","exec","-i","--env","PGPASSWORD",...,"postgres-container"].
async function main() {
  const [command, file] = process.argv.slice(2),
    key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY ?? "", "base64");
  const source =
    command === "restore"
      ? process.env.RECOVERY_DATABASE_URL
      : process.env.BACKUP_DATABASE_URL;
  if (!file || !isAbsolute(file) || !source || key.length !== 32)
    throw new Error(
      "Provide an absolute private archive path, explicit database URL and 32-byte BACKUP_ENCRYPTION_KEY.",
    );
  const path = resolve(file),
    url = new URL(source);
  if (path.startsWith(resolve(import.meta.dirname, "../..") + "/"))
    throw new Error(
      "Store archives outside the repository and Railway volume.",
    );
  if (
    command === "restore" &&
    (!url.pathname.includes("_restore_") ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "Restore target must be an isolated local *_restore_* database. Existing data will never be deleted.",
    );
  const prefix: unknown = JSON.parse(process.env.PG_TOOL_PREFIX ?? "[]");
  if (
    !Array.isArray(prefix) ||
    !prefix.every((v: unknown) => typeof v === "string")
  )
    throw new Error("PG_TOOL_PREFIX must be a JSON string array.");
  function tool(name: string, args: string[]) {
    const parts = [...(prefix as string[]), name, ...args];
    const child = spawn(parts[0]!, parts.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        ...(url.searchParams.get("sslmode")
          ? { PGSSLMODE: url.searchParams.get("sslmode")! }
          : {}),
      },
    });
    child.stderr.resume();
    const done = new Promise<void>((ok, fail) => {
      child.on("error", () => fail(new Error("PG_TOOL_UNAVAILABLE")));
      child.on("close", (code) =>
        code === 0 ? ok() : fail(new Error("PG_TOOL_FAILED")),
      );
    });
    return { child, done };
  }
  try {
    if (command === "backup") {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const ownedFile = await open(path, "wx", 0o600);
      const output = ownedFile.createWriteStream();
      output.write(Buffer.concat([Buffer.from("M8BACK01"), iv]));
      const { child, done } = tool("pg_dump", [
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ]);
      child.stdin.end();
      try {
        await Promise.all([pipeline(child.stdout, cipher, output), done]);
        await appendFile(path, cipher.getAuthTag());
      } catch {
        child.kill();
        await unlink(path).catch(() => {});
        throw new Error("BACKUP_FAILED");
      }
      console.log(
        "Encrypted logical backup completed. Copy to independent storage and verify a restore; creation alone is not recovery acceptance.",
      );
    } else if (command === "restore") {
      const input = await open(path, "r"),
        size = (await input.stat()).size,
        header = Buffer.alloc(20),
        tag = Buffer.alloc(16);
      try {
        await input.read(header, 0, 20, 0);
        await input.read(tag, 0, 16, size - 16);
      } finally {
        await input.close();
      }
      if (size < 36 || header.subarray(0, 8).toString() !== "M8BACK01")
        throw new Error("INVALID_BACKUP");
      // Authenticate the entire archive before passing any SQL to pg_restore.
      const verify = createDecipheriv("aes-256-gcm", key, header.subarray(8));
      verify.setAuthTag(tag);
      const { Writable } = await import("node:stream");
      await pipeline(
        createReadStream(path, { start: 20, end: size - 17 }),
        verify,
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      );
      const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
      decipher.setAuthTag(tag);
      const { child, done } = tool("pg_restore", [
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        "--single-transaction",
        `--dbname=${decodeURIComponent(url.pathname.slice(1))}`,
      ]);
      child.stdout.resume();
      try {
        await Promise.all([
          pipeline(
            createReadStream(path, { start: 20, end: size - 17 }),
            decipher,
            child.stdin,
          ),
          done,
        ]);
      } catch {
        child.kill();
        throw new Error("RESTORE_FAILED");
      }
      console.log(
        "Isolated restore completed. Keep access disabled until current closure fences and authoritative financial reconciliation pass.",
      );
    } else
      throw new Error("Use backup <new-private-archive> or restore <archive>.");
  } catch {
    console.error(
      "BACKUP_OR_RESTORE_FAILED: check tooling, key, target and archive without exposing credentials. No production data was replaced.",
    );
    process.exitCode = 2;
  }
}
void main().catch(() => {
  console.error(
    "RECOVERY_CONFIGURATION_INVALID: verify private configuration; keep access disabled.",
  );
  process.exitCode = 2;
});
