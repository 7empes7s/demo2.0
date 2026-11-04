import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { checkCopy, prune, runBackup, type Source } from "../src/backup.ts";
import { Store } from "../src/db.ts";

const DB_TS = fileURLToPath(new URL("../src/db.ts", import.meta.url));
const BACKUP_TS = fileURLToPath(new URL("../src/backup.ts", import.meta.url));
const NODE_TS = ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "desk-backup-"));
  dirs.push(d);
  return d;
}

/** A Desk database on disk (WAL) with `n` events, plus an Agora-like plain SQLite file. */
function liveFiles(dir: string, n = 20) {
  const desk = join(dir, "desk.db");
  const store = new Store(desk);
  for (let i = 0; i < n; i++) store.append("test.write", "test", `s${i}`, { i }, () => store.setSetting(`k${i}`, "x".repeat(500)));
  store.close();
  const agora = join(dir, "agora.db");
  const a = new DatabaseSync(agora);
  a.exec("CREATE TABLE ideas (id TEXT PRIMARY KEY, title TEXT); INSERT INTO ideas VALUES ('a', 'A bench')");
  a.close();
  const sources: Source[] = [
    { name: "desk", path: desk, chain: true },
    { name: "agora", path: agora, chain: false },
  ];
  return { desk, agora, sources };
}

/** Edits one logged event in place, the way someone with the file could. */
function tamper(file: string) {
  const db = new DatabaseSync(file);
  db.exec("DROP TRIGGER events_no_update; UPDATE events SET payload = '{\"i\":999}' WHERE seq = 3;");
  db.close();
}

const mode = (p: string) => statSync(p).mode & 0o777;

describe("nightly backup", () => {
  it("copies a WAL database while Desk writes to it, and the copies pass both checks", async () => {
    const dir = tempDir();
    const { desk, sources } = liveFiles(dir);
    // A second process appends events as fast as it can for the whole test, like a busy Desk.
    const writerScript = join(dir, "writer.mjs");
    writeFileSync(
      writerScript,
      `import { Store } from ${JSON.stringify(DB_TS)};
       const store = new Store(${JSON.stringify(desk)});
       let n = 0, errors = 0;
       const until = Date.now() + 1500;
       console.log("ready");
       while (Date.now() < until) {
         try { store.append("test.busy", "writer", "w" + n, { n }, () => store.setSetting("w" + n, "y".repeat(800))); n++; }
         catch (e) { errors++; console.error(String(e)); }
       }
       store.close();
       console.log(JSON.stringify({ n, errors }));`,
    );
    const writer = spawn(process.execPath, [...NODE_TS, writerScript], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    writer.stdout.on("data", (b) => (out += b));
    writer.stderr.on("data", (b) => (err += b));
    const done = new Promise<number>((resolve) => writer.on("close", (code) => resolve(code ?? -1)));
    await new Promise<void>((resolve) => {
      const wait = () => (out.includes("ready") ? resolve() : setTimeout(wait, 10));
      wait();
    });
    await new Promise((r) => setTimeout(r, 100));

    const out1 = join(dir, "b1");
    const out2 = join(dir, "b2");
    const first = await runBackup({ sources, out: out1, keepDays: 7, now: new Date("2026-11-04T02:15:00Z") });
    await new Promise((r) => setTimeout(r, 200));
    const second = await runBackup({ sources, out: out2, keepDays: 7, now: new Date("2026-11-04T02:15:00Z") });
    expect(await done).toBe(0);
    const writes = JSON.parse(out.trim().split("\n").at(-1)!) as { n: number; errors: number };

    expect(first.error).toBeNull();
    expect(second.ok).toBe(true);
    expect(writes.errors).toBe(0); // the backup never made a write fail (busy_timeout is 5 s)
    expect(err).toBe("");
    for (const r of [first, second]) {
      const deskCopy = join(r.dir!, "desk.db");
      const check = checkCopy(deskCopy, true);
      expect(check).toMatchObject({ ok: true, integrity: "ok", chain: { ok: true, broken_at: null } });
      expect(checkCopy(join(r.dir!, "agora.db"), false)).toMatchObject({ ok: true, integrity: "ok", chain: null });
    }
    // The copies were taken mid-stream: more entries than the start, fewer than the end.
    const live = new Store(desk);
    const end = live.verify();
    live.close();
    const firstEntries = first.copies[0].chain!.entries;
    expect(firstEntries).toBeGreaterThan(20);
    expect(firstEntries).toBeLessThan(end.entries);
    expect(second.copies[0].chain!.entries).toBeGreaterThan(firstEntries);
    expect(end.entries).toBe(20 + writes.n);
  });

  it("writes mode 600 files in a mode 700 folder, with a manifest of hashes", async () => {
    const dir = tempDir();
    const { sources } = liveFiles(dir);
    const out = join(dir, "backups");
    const r = await runBackup({ sources, out, keepDays: 7, now: new Date("2026-11-04T02:15:00Z") });
    expect(r.ok).toBe(true);
    expect(r.dir).toBe(join(out, "2026-11-04"));
    expect(readdirSync(r.dir!).sort()).toEqual(["agora.db", "desk.db", "manifest.json"]);
    expect(mode(out)).toBe(0o700);
    expect(mode(r.dir!)).toBe(0o700);
    for (const f of readdirSync(r.dir!)) expect(mode(join(r.dir!, f))).toBe(0o600);
    const manifest = JSON.parse(readFileSync(join(r.dir!, "manifest.json"), "utf8"));
    expect(manifest.copies.map((c: { name: string }) => c.name)).toEqual(["desk", "agora"]);
    expect(manifest.copies[0].chain).toMatchObject({ ok: true, entries: 20 });
    // The copy is a lone file: no -wal or -shm next to it.
    expect(readdirSync(r.dir!).some((f) => f.endsWith("-wal") || f.endsWith("-shm"))).toBe(false);
  });

  it("fails on a tampered log, keeps the previous good backup and removes nothing", async () => {
    const dir = tempDir();
    const { desk, sources } = liveFiles(dir);
    const out = join(dir, "backups");
    // Old good backups, all past the limit, and one from yesterday.
    for (const day of ["2026-10-01", "2026-10-02", "2026-11-03"]) mkdirSync(join(out, day), { recursive: true });
    const good = await runBackup({ sources, out, keepDays: 7, now: new Date("2026-11-04T02:15:00Z") });
    expect(good.removed).toEqual(["2026-10-01", "2026-10-02"]);
    const goodBytes = readFileSync(join(out, "2026-11-04", "desk.db"));

    tamper(desk);
    // The tampered copy itself fails the chain check.
    expect(checkCopy(desk, true)).toMatchObject({ ok: false, integrity: "ok", chain: { ok: false, broken_at: 3 } });

    const bad = await runBackup({ sources, out, keepDays: 1, now: new Date("2026-11-04T05:00:00Z") });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/desk: the copy failed its check \(chain broken at entry 3\)/);
    // Same day's good copy untouched, yesterday's kept even though keepDays is 1, no partial left.
    expect(readFileSync(join(out, "2026-11-04", "desk.db")).equals(goodBytes)).toBe(true);
    expect(readdirSync(out).sort()).toEqual(["2026-11-03", "2026-11-04"]);

    // The command line says so with exit code 1.
    const cli = spawnSync(process.execPath, [...NODE_TS, BACKUP_TS, "--out", out, "--desk", desk], { encoding: "utf8" });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/backup failed, previous backups kept/);
    expect(readdirSync(out).sort()).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("fails when a database is missing", async () => {
    const dir = tempDir();
    const out = join(dir, "backups");
    const r = await runBackup({ sources: [{ name: "desk", path: join(dir, "nope.db"), chain: true }], out, keepDays: 7 });
    expect(r).toMatchObject({ ok: false, dir: null });
    expect(r.error).toMatch(/does not exist/);
    expect(readdirSync(out)).toEqual([]);
  });

  it("retention removes copies past the limit and never the newest", () => {
    const out = tempDir();
    for (const day of ["2026-10-20", "2026-10-27", "2026-10-29", "2026-11-01", "2026-11-03"]) mkdirSync(join(out, day));
    mkdirSync(join(out, "not-a-day"));
    expect(prune(out, 7, "2026-11-04")).toEqual(["2026-10-20", "2026-10-27"]);
    expect(readdirSync(out).sort()).toEqual(["2026-10-29", "2026-11-01", "2026-11-03", "not-a-day"]);
    // Backups stopped for weeks: everything is past the limit, the newest still stays.
    expect(prune(out, 7, "2026-12-31")).toEqual(["2026-10-29", "2026-11-01"]);
    expect(readdirSync(out).sort()).toEqual(["2026-11-03", "not-a-day"]);
  });

  it("a second run the same day replaces that day's folder; the restore check reads it", async () => {
    const dir = tempDir();
    const { sources } = liveFiles(dir);
    const out = join(dir, "backups");
    await runBackup({ sources, out, keepDays: 7, now: new Date("2026-11-04T02:15:00Z") });
    const store = new Store(sources[0].path);
    store.append("test.more", "test", "m", {}, () => undefined);
    store.close();
    const again = await runBackup({ sources, out, keepDays: 7, now: new Date("2026-11-04T09:00:00Z") });
    expect(again.copies[0].chain!.entries).toBe(21);
    expect(readdirSync(out)).toEqual(["2026-11-04"]);
    const cli = spawnSync(process.execPath, [...NODE_TS, BACKUP_TS, "--check", join(out, "2026-11-04", "desk.db"), "--chain"], { encoding: "utf8" });
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ ok: true, chain: { entries: 21 } });
    expect(existsSync(join(out, "2026-11-04", "desk.db-wal"))).toBe(false);
  });
});
