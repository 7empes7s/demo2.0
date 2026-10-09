/**
 * Desk's store: one SQLite file. Every write goes through `append`, which adds an entry to the
 * hash-chained `events` table in the same transaction as the row it changes. The audit portal
 * replays that chain; a changed or deleted entry breaks every hash after it.
 */

import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type Role = "admin" | "operator" | "auditor";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS staff_sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrol_codes (code_hash TEXT PRIMARY KEY, batch TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS residents (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS procedures (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  owner TEXT NOT NULL, stages TEXT NOT NULL, links TEXT NOT NULL, docket_item_id TEXT,
  started_on TEXT, due_on TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS procedure_updates (id TEXT PRIMARY KEY, procedure_id TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL, status_after TEXT NOT NULL, staff_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS verdicts (id TEXT PRIMARY KEY, procedure_id TEXT NOT NULL, resident_id TEXT NOT NULL, verdict TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS verdicts_by_procedure ON verdicts (procedure_id, resident_id, at);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY, resident_id TEXT NOT NULL, lang TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL, procedure_id TEXT, answer TEXT, answered_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supports (idea_id TEXT NOT NULL, resident_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (idea_id, resident_id));
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, resident_id TEXT, about_kind TEXT NOT NULL, about_id TEXT,
  category TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, summary TEXT,
  answer TEXT, answer_public INTEGER NOT NULL DEFAULT 0, answered_at TEXT, staff_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, detail TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL,
  about_kind TEXT NOT NULL, about_id TEXT, opens_at TEXT, closes_at TEXT, result TEXT, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ballots (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, resident_id TEXT NOT NULL, option INTEGER NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ballots_by_round ON ballots (round_id, resident_id, seq);
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, purpose TEXT NOT NULL, model TEXT NOT NULL, prompt_sha256 TEXT NOT NULL,
  input_chars INTEGER NOT NULL, output_chars INTEGER NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT, staff_id TEXT
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
  subject TEXT NOT NULL, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
-- The log is append only: no row of it can be changed or removed through this connection.
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append only'); END;
CREATE TRIGGER IF NOT EXISTS ballots_no_update BEFORE UPDATE ON ballots BEGIN SELECT RAISE(ABORT, 'ballots are append only'); END;
CREATE TRIGGER IF NOT EXISTS ballots_no_delete BEFORE DELETE ON ballots BEGIN SELECT RAISE(ABORT, 'ballots are append only'); END;
-- One signed checkpoint of the log per day (fingerprint.ts). The checkpoint never changes; the
-- Bitcoin timestamp receipt is added once, later.
CREATE TABLE IF NOT EXISTS fingerprints (
  day TEXT PRIMARY KEY, size INTEGER NOT NULL, root TEXT NOT NULL, note TEXT NOT NULL, signed_at TEXT NOT NULL,
  ots BLOB, ots_calendar TEXT
);
CREATE TRIGGER IF NOT EXISTS fingerprints_no_change BEFORE UPDATE OF day, size, root, note, signed_at ON fingerprints BEGIN SELECT RAISE(ABORT, 'fingerprints are append only'); END;
CREATE TRIGGER IF NOT EXISTS fingerprints_ots_once BEFORE UPDATE OF ots, ots_calendar ON fingerprints WHEN OLD.ots IS NOT NULL BEGIN SELECT RAISE(ABORT, 'a receipt is stored once'); END;
CREATE TRIGGER IF NOT EXISTS fingerprints_no_delete BEFORE DELETE ON fingerprints BEGIN SELECT RAISE(ABORT, 'fingerprints are append only'); END;
`;

export const GENESIS = "0".repeat(64);

export function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Lower-case base32 (Crockford alphabet), the shape of every id and code residents see. */
export function newId(bytes = 10): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const buf = randomBytes(bytes);
  let out = "";
  for (const b of buf) out += alphabet[b % 32];
  return out;
}

/** Canonical JSON: keys sorted, no whitespace, so a hash is the same on every machine. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

export interface EventRow {
  seq: number;
  at: string;
  kind: string;
  actor: string;
  subject: string;
  payload: string;
  prev_hash: string;
  hash: string;
}

/** The hash of one entry: everything in it plus the hash before it. */
export function eventHash(e: Omit<EventRow, "hash">): string {
  return sha256([e.seq, e.at, e.kind, e.actor, e.subject, e.payload, e.prev_hash].join("\n"));
}

export class Store {
  readonly db: DatabaseSync;
  /** Test seam: a fixed clock makes hashes reproducible. */
  now: () => string;

  constructor(path = ":memory:", now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.now = now;
  }

  close() {
    this.db.close();
  }

  setting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string) {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** The last entry's hash (the head), or the genesis hash on an empty log. */
  head(): { seq: number; hash: string } {
    const row = this.db.prepare("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1").get() as { seq: number; hash: string } | undefined;
    return row ?? { seq: 0, hash: GENESIS };
  }

  /**
   * Runs `write` and appends one event in the same transaction. The event's payload is what
   * the audit log shows; keep resident text out of it where a hash or a length will do.
   */
  append<T>(kind: string, actor: string, subject: string, payload: Record<string, unknown>, write: () => T): { result: T; seq: number; hash: string } {
    // node:sqlite has no transaction helper yet; BEGIN IMMEDIATE takes the write lock up front.
    const run = () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const out = body();
        this.db.exec("COMMIT");
        return out;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    };
    const body = () => {
      const result = write();
      const prev = this.head();
      const entry = { seq: prev.seq + 1, at: this.now(), kind, actor, subject, payload: canonical(payload), prev_hash: prev.hash };
      const hash = eventHash(entry);
      this.db
        .prepare("INSERT INTO events (seq, at, kind, actor, subject, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(entry.seq, entry.at, entry.kind, entry.actor, entry.subject, entry.payload, entry.prev_hash, hash);
      return { result, seq: entry.seq, hash };
    };
    return run();
  }

  events(opts: { from?: number; kind?: string; subject?: string; limit?: number } = {}): EventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.from) {
      where.push("seq >= ?");
      args.push(opts.from);
    }
    if (opts.kind) {
      where.push("kind LIKE ?");
      args.push(opts.kind.replace(/[%_]/g, "") + "%");
    }
    if (opts.subject) {
      where.push("subject = ?");
      args.push(opts.subject);
    }
    const sql = `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq ASC LIMIT ?`;
    args.push(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
    return this.db.prepare(sql).all(...args) as unknown as EventRow[];
  }

  /** Replays the whole chain. Returns the first broken entry, if any. */
  verify(): { ok: boolean; entries: number; head: string; broken_at: number | null } {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY seq ASC").all() as unknown as EventRow[];
    let prev = GENESIS;
    let expectSeq = 1;
    for (const row of rows) {
      if (row.seq !== expectSeq || row.prev_hash !== prev || eventHash(row) !== row.hash) {
        return { ok: false, entries: rows.length, head: prev, broken_at: row.seq };
      }
      prev = row.hash;
      expectSeq++;
    }
    return { ok: true, entries: rows.length, head: prev, broken_at: null };
  }
}
