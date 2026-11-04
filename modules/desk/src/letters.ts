/**
 * Asking for a code by post. A resident without an enrolment code gives a name and an address in
 * the commune; an admin checks it against the commune's residents' register and prints a letter
 * with a fresh code. The name and address live only while the request waits: printing or declining
 * deletes them. Desk never stores a name next to a code, so it cannot tell whose letter became which
 * resident. The log keeps that a request came in and how it ended, never who asked.
 *
 * The one thing kept after printing is a keyed hash of the normalised name and address, with no date,
 * so a second request for the same person shows "a letter already went to this name and address".
 *
 * The asking device gets a random request code back. Desk keeps only a keyed hash of it with the
 * outcome (waiting, sent, declined and why) and the Monday the row expires, so the sign-in sheet can
 * say "your request was declined" without Desk keeping any way to reach the resident.
 */

import { createHmac, randomBytes } from "node:crypto";

import { DeskError, insertEnrolCodes } from "./auth.ts";
import { newId, Store } from "./db.ts";

/** Requests waiting at once; past this the form says to try later (a flood cannot fill the disk). */
export const MAX_PENDING = 5000;

/** Why an admin declined a request; the resident's device shows the matching sentence. */
export const DECLINE_REASONS = ["not_in_register", "outside_commune", "asked_twice", "address_incomplete"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** A status row is deleted this many days after its last change (rounded up to a Monday). Not a Charter rule. */
export const STATUS_DAYS = 60;

export type LetterStatus = { status: "waiting" | "sent" } | { status: "declined"; reason: DeclineReason };

export interface LetterRequest {
  id: string;
  name: string;
  street: string;
  extra: string;
  postcode: string;
  created_at: string;
  /** A letter already went to this name and address: lost, or asked twice. The admin decides. */
  sent_before: boolean;
  /** Another waiting request has the same name and address. */
  duplicate: boolean;
  /** The postcode is not in the commune's ranges (set after the request came in): no letter can be printed. */
  outside: boolean;
}

export interface Letter {
  name: string;
  street: string;
  extra: string;
  postcode: string;
  code: string;
}

const clean = (v: unknown): string =>
  typeof v === "string"
    ? v
        .normalize("NFC")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

function lettersKey(store: Store): string {
  let secret = store.setting("letters.key");
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    store.setSetting("letters.key", secret);
  }
  return secret;
}

/** The same person however it was typed: case, accents, spaces and punctuation do not count. */
function personKey(store: Store, name: string, street: string, postcode: string): string {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  return createHmac("sha256", lettersKey(store)).update([fold(name), fold(street), postcode].join("\n")).digest("hex");
}

/** The status row's key: a keyed hash of the request code, so the table alone never matches a device. */
function statusKey(store: Store, code: string): string {
  return createHmac("sha256", lettersKey(store)).update(`status\n${code}`).digest("hex");
}

const REQUEST_CODE = /^[A-Za-z0-9_-]{24}$/;

/** The Monday on or after `STATUS_DAYS` from now: rows share a week, so the table keeps no order of changes. */
function expiry(store: Store): string {
  const d = new Date(Date.parse(store.now()) + STATUS_DAYS * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * The commune's postcodes, as ranges such as "4001-4398" or single codes such as "4410", from an
 * admin's list or text (commas, semicolons or new lines between them). An empty list means no check.
 */
export function parsePostcodes(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")) : typeof v === "string" ? [v] : null;
  if (!parts) throw new DeskError(400, "postcodes must be a list of ranges such as 4001-4398");
  const tokens = parts.flatMap((p) => p.split(/[,;\n]+/)).map((p) => p.trim()).filter(Boolean);
  if (tokens.length > 200) throw new DeskError(400, "at most 200 postcode ranges");
  return tokens.map((tok) => {
    const m = /^(?:L\s*-?\s*)?(\d{4})(?:\s*[-–]\s*(?:L\s*-?\s*)?(\d{4}))?$/i.exec(tok);
    if (!m) throw new DeskError(400, `"${tok.slice(0, 20)}" is not a postcode or a range such as 4001-4398`);
    if (m[2] && m[2] < m[1]) throw new DeskError(400, `the range ${m[1]}-${m[2]} ends before it starts`);
    return m[2] && m[2] !== m[1] ? `${m[1]}-${m[2]}` : m[1];
  });
}

export function communePostcodes(store: Store): string[] {
  try {
    const list = JSON.parse(store.setting("commune.postcodes") ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Whether a four-digit postcode is in the commune. With no ranges set, every postcode is. */
export function inCommune(store: Store, postcode: string, ranges = communePostcodes(store)): boolean {
  if (!ranges.length) return true;
  return ranges.some((r) => {
    const [from, to = from] = r.split("-");
    return postcode >= from && postcode <= to;
  });
}

/** Deletes status rows past their Monday. Their count goes in the log; nothing else is known about them. */
export function expireLetterStatus(store: Store): number {
  const today = store.now().slice(0, 10);
  const n = (store.db.prepare("SELECT COUNT(*) AS n FROM letter_status WHERE expires <= ?").get(today) as { n: number }).n;
  if (!n) return 0;
  store.append("enrol.letter_status_expired", "system", "letter_status", { count: n }, () => {
    store.db.prepare("DELETE FROM letter_status WHERE expires <= ?").run(today);
  });
  return n;
}

/** What the device that asked may learn: only for its own code, and nothing at all for any other. */
export function letterStatus(store: Store, code: unknown): LetterStatus {
  expireLetterStatus(store);
  const row = typeof code === "string" && REQUEST_CODE.test(code) ? (store.db.prepare("SELECT status, reason FROM letter_status WHERE status_key = ?").get(statusKey(store, code)) as { status: string; reason: string | null } | undefined) : undefined;
  if (!row) throw new DeskError(404, "no request with that code");
  if (row.status === "declined") return { status: "declined", reason: row.reason as DeclineReason };
  return { status: row.status as "waiting" | "sent" };
}

/** Luxembourg postcodes are four digits, often written L-4002. */
function postcodeOf(v: unknown): string {
  const m = /^\s*(?:L\s*-?\s*)?(\d{4})\s*$/i.exec(typeof v === "string" ? v : "");
  if (!m) throw new DeskError(400, "a postcode has four digits, such as L-4002");
  return m[1];
}

/**
 * A resident asks for a letter. Asking again for the same name and address changes nothing (and
 * gives no new request code: the first device keeps the one it got). A postcode outside the
 * commune's ranges is refused with the code `outside_commune`.
 */
export function requestLetter(store: Store, body: Record<string, unknown>): { received: true; already: boolean; request_code?: string } {
  const name = clean(body.name);
  const street = clean(body.street);
  const extra = clean(body.extra);
  const postcode = postcodeOf(body.postcode);
  if (name.length < 2 || name.length > 120) throw new DeskError(400, "a name has 2 to 120 characters");
  if (street.length < 3 || street.length > 160) throw new DeskError(400, "a street and number have 3 to 160 characters");
  if (extra.length > 80) throw new DeskError(400, "the extra address line has at most 80 characters");
  if (!inCommune(store, postcode)) throw new DeskError(400, "this postcode is not in the commune; ask your own commune for a code", "outside_commune");
  expireLetterStatus(store);
  const key = personKey(store, name, street, postcode);
  if (store.db.prepare("SELECT 1 FROM letter_requests WHERE person_key = ?").get(key)) return { received: true, already: true };
  const pending = (store.db.prepare("SELECT COUNT(*) AS n FROM letter_requests").get() as { n: number }).n;
  if (pending >= MAX_PENDING) throw new DeskError(503, "too many requests are waiting, try again in a few days");
  const id = newId();
  const at = store.now();
  const code = randomBytes(18).toString("base64url");
  const status = statusKey(store, code);
  // The log says a request came in; never who asked.
  store.append("enrol.letter_requested", "anonymous", `letter:${id}`, {}, () => {
    store.db
      .prepare("INSERT INTO letter_requests (id, name, street, extra, postcode, person_key, created_at, status_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, street, extra, postcode, key, at, status);
    store.db.prepare("INSERT INTO letter_status (status_key, status, reason, expires) VALUES (?, 'waiting', NULL, ?)").run(status, expiry(store));
  });
  return { received: true, already: false, request_code: code };
}

/** Moves the request's status row on (if it has one: requests made before request codes do not). */
function setStatus(store: Store, key: string | null, status: "sent" | "declined", reason: DeclineReason | null) {
  if (!key) return;
  store.db.prepare("INSERT INTO letter_status (status_key, status, reason, expires) VALUES (?, ?, ?, ?) ON CONFLICT (status_key) DO UPDATE SET status = excluded.status, reason = excluded.reason, expires = excluded.expires").run(key, status, reason, expiry(store));
}

export function letterRequests(store: Store): LetterRequest[] {
  const rows = store.db.prepare("SELECT id, name, street, extra, postcode, person_key, created_at FROM letter_requests ORDER BY created_at, id").all() as unknown as (Omit<LetterRequest, "sent_before" | "duplicate"> & { person_key: string })[];
  const sent = store.db.prepare("SELECT 1 FROM letters_sent WHERE person_key = ?");
  const ranges = communePostcodes(store);
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.person_key, (seen.get(r.person_key) ?? 0) + 1);
  return rows.map(({ person_key, ...r }) => ({ ...r, sent_before: !!sent.get(person_key), duplicate: (seen.get(person_key) ?? 0) > 1, outside: !inCommune(store, r.postcode, ranges) }));
}

export function pendingLetters(store: Store): number {
  return (store.db.prepare("SELECT COUNT(*) AS n FROM letter_requests").get() as { n: number }).n;
}

/**
 * Makes one code per chosen request, deletes the requests' names and addresses, and hands back the
 * letters to print, shuffled so their order says nothing about the requests'. The codes join the
 * month's "by post" batch, so a batch never names a single letter. Shown once, like any batch.
 */
export function printLetters(store: Store, by: string, ids: unknown): Letter[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((i) => typeof i === "string")) throw new DeskError(400, "ids must list 1 to 500 requests");
  const unique = [...new Set(ids as string[])];
  const get = store.db.prepare("SELECT id, name, street, extra, postcode, person_key, status_key FROM letter_requests WHERE id = ?");
  const rows = unique.map((id) => get.get(id) as (Letter & { id: string; person_key: string; status_key: string | null }) | undefined);
  if (rows.some((r) => !r)) throw new DeskError(404, "a request is no longer waiting; reload the list");
  // A letter carries the commune's name under the postcode: one for another town would go astray.
  const ranges = communePostcodes(store);
  if (rows.some((r) => !inCommune(store, r!.postcode, ranges))) throw new DeskError(409, "a request has a postcode outside the commune; decline it instead", "outside_commune");
  const batch = `by post ${store.now().slice(0, 7)}`;
  const { result: codes } = store.append("enrol.letters_printed", by, `batch:${batch}`, { batch, count: rows.length, requests: unique.slice().sort() }, () => {
    const del = store.db.prepare("DELETE FROM letter_requests WHERE id = ?");
    const keep = store.db.prepare("INSERT OR IGNORE INTO letters_sent (person_key) VALUES (?)");
    for (const r of rows) {
      del.run(r!.id);
      keep.run(r!.person_key);
      setStatus(store, r!.status_key, "sent", null);
    }
    return insertEnrolCodes(store, batch, rows.length);
  });
  const letters = shuffle(rows.map((r, i) => ({ name: r!.name, street: r!.street, extra: r!.extra, postcode: r!.postcode, code: codes[i] })));
  return letters;
}

/**
 * Removes a request without a letter, for one of the fixed reasons. The device that asked sees the
 * reason on its next visit; the log keeps the reason, never who asked.
 */
export function declineLetter(store: Store, by: string, id: string, reason: unknown): void {
  if (!(DECLINE_REASONS as readonly unknown[]).includes(reason)) throw new DeskError(400, `reason must be one of ${DECLINE_REASONS.join(", ")}`);
  const row = store.db.prepare("SELECT status_key FROM letter_requests WHERE id = ?").get(id) as { status_key: string | null } | undefined;
  if (!row) throw new DeskError(404, "no such request");
  store.append("enrol.letter_declined", by, `letter:${id}`, { reason }, () => {
    store.db.prepare("DELETE FROM letter_requests WHERE id = ?").run(id);
    setStatus(store, row.status_key, "declined", reason as DeclineReason);
  });
}

function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const UNUSED_DEMO = 1;
