/**
 * Nightly backup of the Desk and Agora databases, with a check on every copy.
 *
 * Both are SQLite files that a running service writes to (Desk in WAL mode), so a plain `cp` can
 * catch a half-written page. This uses SQLite's online backup in one step: in WAL mode that is a
 * single read transaction, which never blocks Desk's writers.
 *
 * Each run writes into `<out>/.partial-*`, checks every copy (opened read only: `PRAGMA
 * integrity_check`, and for Desk the same chain replay `GET /audit/verify` runs), and only then
 * renames the folder to `<out>/YYYY-MM-DD`. A failed run removes its partial folder, deletes
 * nothing else and exits 1, so the previous good backup stays. Only after a good run are
 * folders older than `--keep-days` removed, and the newest one never is.
 *
 * The copies hold personal data (waiting letter requests) and the `letters.key` secret: folders
 * are mode 700 and files mode 600, owned by whoever runs this (the `civic` user on Mulinux).
 *
 *   backup.ts --out /var/backups/civic --keep-days 7 --desk /var/lib/civic-desk/desk.db --agora /var/lib/civic-agora/agora.db
 *   backup.ts --check /var/backups/civic/2026-11-04/desk.db --chain     (restore drill)
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { type ChainCheck, verifyChain } from "./db.ts";

export interface Source {
  /** File name of the copy, without `.db`: `desk` or `agora`. */
  name: string;
  path: string;
  /** Replay Desk's hash-chained log on the copy. */
  chain: boolean;
}

export interface CopyCheck {
  ok: boolean;
  integrity: string;
  chain: ChainCheck | null;
}

export interface CopyReport {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
  chain: ChainCheck | null;
}

export interface BackupResult {
  ok: boolean;
  dir: string | null;
  copies: CopyReport[];
  removed: string[];
  error: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Opens a copy read only and checks it: SQLite's own integrity check, then the chain if asked. */
export function checkCopy(file: string, chain: boolean): CopyCheck {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const integrity = rows.map((r) => r.integrity_check).join("; ");
    const log = chain ? verifyChain(db) : null;
    return { ok: integrity === "ok" && (log?.ok ?? true), integrity, chain: log };
  } finally {
    db.close();
  }
}

/**
 * Removes day folders `keepDays` or more days older than `today`, except the newest one.
 * Returns the names removed.
 */
export function prune(root: string, keepDays: number, today: string): string[] {
  const days = readdirSync(root)
    .filter((n) => DAY.test(n) && statSync(join(root, n)).isDirectory())
    .sort();
  const newest = days.at(-1);
  const removed: string[] = [];
  for (const day of days) {
    if (day === newest) continue;
    if ((Date.parse(today) - Date.parse(day)) / DAY_MS >= keepDays) {
      rmSync(join(root, day), { recursive: true, force: true });
      removed.push(day);
    }
  }
  return removed;
}

async function copyOne(src: Source, dir: string): Promise<CopyReport> {
  if (!existsSync(src.path)) throw new Error(`${src.name}: ${src.path} does not exist`);
  const file = join(dir, `${src.name}.db`);
  const live = new DatabaseSync(src.path, { readOnly: true });
  try {
    live.exec("PRAGMA busy_timeout = 5000;");
    // rate -1: every page in one step, so one read transaction and no restart when Desk writes.
    await backup(live, file, { rate: -1 });
  } finally {
    live.close();
  }
  // The copy inherits WAL mode; a lone file is easier to open read only, restore and move.
  const copy = new DatabaseSync(file);
  copy.exec("PRAGMA journal_mode = DELETE;");
  copy.close();
  chmodSync(file, 0o600);
  const check = checkCopy(file, src.chain);
  if (!check.ok) {
    const why = check.integrity !== "ok" ? `integrity_check: ${check.integrity}` : `chain broken at entry ${check.chain?.broken_at}`;
    throw new Error(`${src.name}: the copy failed its check (${why})`);
  }
  const bytes = readFileSync(file);
  return { name: src.name, file: `${src.name}.db`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), chain: check.chain };
}

export async function runBackup(opts: { sources: Source[]; out: string; keepDays: number; now?: Date }): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  mkdirSync(opts.out, { recursive: true, mode: 0o700 });
  chmodSync(opts.out, 0o700);
  // A run killed half way leaves a partial folder; it was never a good backup.
  for (const n of readdirSync(opts.out)) if (n.startsWith(".partial-") || n.startsWith(".replaced-")) rmSync(join(opts.out, n), { recursive: true, force: true });

  const tmp = join(opts.out, `.partial-${day}-${process.pid}`);
  mkdirSync(tmp, { mode: 0o700 });
  const copies: CopyReport[] = [];
  try {
    if (opts.sources.length === 0) throw new Error("nothing to back up");
    for (const src of opts.sources) copies.push(await copyOne(src, tmp));
    const manifest = join(tmp, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ at: now.toISOString(), copies }, null, 2) + "\n", { mode: 0o600 });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    return { ok: false, dir: null, copies, removed: [], error: (err as Error).message };
  }

  // A second run on the same day replaces that day's folder, only now that the new one is good.
  const dir = join(opts.out, day);
  const old = join(opts.out, `.replaced-${day}-${process.pid}`);
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(tmp, dir);
  rmSync(old, { recursive: true, force: true });
  const removed = prune(opts.out, opts.keepDays, day);
  return { ok: true, dir, copies, removed, error: null };
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      "keep-days": { type: "string", default: "7" },
      desk: { type: "string" },
      agora: { type: "string" },
      check: { type: "string" },
      chain: { type: "boolean", default: false },
    },
  });
  if (values.check) {
    const result = checkCopy(values.check, values.chain);
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
  const keepDays = Number(values["keep-days"]);
  if (!values.out || !Number.isInteger(keepDays) || keepDays < 1) {
    console.error("usage: backup.ts --out DIR [--keep-days N] [--desk FILE] [--agora FILE] | --check FILE [--chain]");
    return 2;
  }
  const sources: Source[] = [];
  if (values.desk) sources.push({ name: "desk", path: values.desk, chain: true });
  if (values.agora) sources.push({ name: "agora", path: values.agora, chain: false });
  const result = await runBackup({ sources, out: values.out, keepDays });
  if (!result.ok) {
    console.error(`backup failed, previous backups kept: ${result.error}`);
    return 1;
  }
  for (const c of result.copies) {
    const log = c.chain ? `, chain ok, ${c.chain.entries} entries, head ${c.chain.head}` : "";
    console.log(`${c.name}: ${c.bytes} bytes, integrity ok${log}`);
  }
  console.log(`backup written to ${result.dir}${result.removed.length ? `; removed ${result.removed.join(", ")}` : ""}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
