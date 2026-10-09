/**
 * Asking for a code by post. A resident without an enrolment code gives a name and an address in
 * the commune; an admin checks it against the commune's residents' register and prints a letter
 * with a fresh code. The name and address live only while the request waits: printing or declining
 * deletes them. Desk never stores a name next to a code, so it cannot tell whose letter became which
 * resident. The log keeps that a request came in and how it ended, never who asked.
 *
 * The one thing kept after printing is a keyed hash of the normalised name and address, with no date,
 * so a second request for the same person shows "a letter already went to this name and address".
 */

import { createHmac, randomBytes } from "node:crypto";

import { DeskError, insertEnrolCodes } from "./auth.ts";
import { newId, Store } from "./db.ts";

/** Requests waiting at once; past this the form says to try later (a flood cannot fill the disk). */
export const MAX_PENDING = 5000;

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

/** The same person however it was typed: case, accents, spaces and punctuation do not count. */
function personKey(store: Store, name: string, street: string, postcode: string): string {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  let secret = store.setting("letters.key");
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    store.setSetting("letters.key", secret);
  }
  return createHmac("sha256", secret).update([fold(name), fold(street), postcode].join("\n")).digest("hex");
}

/** Luxembourg postcodes are four digits, often written L-4002. */
function postcodeOf(v: unknown): string {
  const m = /^\s*(?:L\s*-?\s*)?(\d{4})\s*$/i.exec(typeof v === "string" ? v : "");
  if (!m) throw new DeskError(400, "a postcode has four digits, such as L-4002");
  return m[1];
}

/** A resident asks for a letter. Asking again for the same name and address changes nothing. */
export function requestLetter(store: Store, body: Record<string, unknown>): { received: true; already: boolean } {
  const name = clean(body.name);
  const street = clean(body.street);
  const extra = clean(body.extra);
  const postcode = postcodeOf(body.postcode);
  if (name.length < 2 || name.length > 120) throw new DeskError(400, "a name has 2 to 120 characters");
  if (street.length < 3 || street.length > 160) throw new DeskError(400, "a street and number have 3 to 160 characters");
  if (extra.length > 80) throw new DeskError(400, "the extra address line has at most 80 characters");
  const key = personKey(store, name, street, postcode);
  if (store.db.prepare("SELECT 1 FROM letter_requests WHERE person_key = ?").get(key)) return { received: true, already: true };
  const pending = (store.db.prepare("SELECT COUNT(*) AS n FROM letter_requests").get() as { n: number }).n;
  if (pending >= MAX_PENDING) throw new DeskError(503, "too many requests are waiting, try again in a few days");
  const id = newId();
  const at = store.now();
  // The log says a request came in; never who asked.
  store.append("enrol.letter_requested", "anonymous", `letter:${id}`, {}, () => {
    store.db
      .prepare("INSERT INTO letter_requests (id, name, street, extra, postcode, person_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, street, extra, postcode, key, at);
  });
  return { received: true, already: false };
}

export function letterRequests(store: Store): LetterRequest[] {
  const rows = store.db.prepare("SELECT id, name, street, extra, postcode, person_key, created_at FROM letter_requests ORDER BY created_at, id").all() as unknown as (Omit<LetterRequest, "sent_before" | "duplicate"> & { person_key: string })[];
  const sent = store.db.prepare("SELECT 1 FROM letters_sent WHERE person_key = ?");
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.person_key, (seen.get(r.person_key) ?? 0) + 1);
  return rows.map(({ person_key, ...r }) => ({ ...r, sent_before: !!sent.get(person_key), duplicate: (seen.get(person_key) ?? 0) > 1 }));
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
  const get = store.db.prepare("SELECT id, name, street, extra, postcode, person_key FROM letter_requests WHERE id = ?");
  const rows = unique.map((id) => get.get(id) as (Letter & { id: string; person_key: string }) | undefined);
  if (rows.some((r) => !r)) throw new DeskError(404, "a request is no longer waiting; reload the list");
  const batch = `by post ${store.now().slice(0, 7)}`;
  const { result: codes } = store.append("enrol.letters_printed", by, `batch:${batch}`, { batch, count: rows.length, requests: unique.slice().sort() }, () => {
    const del = store.db.prepare("DELETE FROM letter_requests WHERE id = ?");
    const keep = store.db.prepare("INSERT OR IGNORE INTO letters_sent (person_key) VALUES (?)");
    for (const r of rows) {
      del.run(r!.id);
      keep.run(r!.person_key);
    }
    return insertEnrolCodes(store, batch, rows.length);
  });
  const letters = shuffle(rows.map((r, i) => ({ name: r!.name, street: r!.street, extra: r!.extra, postcode: r!.postcode, code: codes[i] })));
  return letters;
}

/** Removes a request without a letter: not a resident, an address outside the commune, nonsense. */
export function declineLetter(store: Store, by: string, id: string): void {
  if (!store.db.prepare("SELECT 1 FROM letter_requests WHERE id = ?").get(id)) throw new DeskError(404, "no such request");
  store.append("enrol.letter_declined", by, `letter:${id}`, {}, () => {
    store.db.prepare("DELETE FROM letter_requests WHERE id = ?").run(id);
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
