/**
 * The Desk log's daily public fingerprint. Once a day Desk signs a checkpoint of its event log:
 * a Merkle tree (RFC 9162) whose leaves are the events' hashes, in the checkpoint and signed-note
 * format of Record (`spec/record/README.md`, sections 2 to 4). The checkpoints are public, and so
 * are consistency proofs between any two of them, so anyone can check that each day's log
 * contains the day before's unchanged without seeing a single event. Each checkpoint is also sent
 * to an OpenTimestamps calendar, whose receipt dates it in Bitcoin.
 *
 * What is published holds no personal data: a checkpoint is the log's name, a count, a root hash
 * and a time; a proof is hashes of hashes. Events and their hashes stay with the auditors.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

import type { Store } from "./db.ts";

/* ---- keys and signed notes (C2SP signed-note, Ed25519), as Record encodes them */

const ALG_ED25519 = 0x01;
const SIG_PREFIX = "— ";
const NAME = /^[^\s+]+$/;
// DER prefixes that wrap a raw Ed25519 seed (PKCS #8) or public key (SPKI).
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function sha256(...parts: (string | Buffer)[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

export function keyId(name: string, publicKey: Buffer): Buffer {
  return sha256(name, Buffer.from([0x0a, ALG_ED25519]), publicKey).subarray(0, 4);
}

export interface Verifier {
  name: string;
  publicKey: Buffer;
  id: Buffer;
  key: KeyObject;
}

export interface Signer extends Verifier {
  privateKey: KeyObject;
  seed: Buffer;
}

function verifierFrom(name: string, publicKey: Buffer): Verifier {
  return { name, publicKey, id: keyId(name, publicKey), key: createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: "der", type: "spki" }) };
}

function signerFrom(name: string, seed: Buffer): Signer {
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x as string, "base64url");
  return { ...verifierFrom(name, publicKey), privateKey, seed };
}

export function generateSigner(name: string): Signer {
  if (!NAME.test(name)) throw new Error("the log's name must be non-empty with no spaces or '+'");
  const { privateKey } = generateKeyPairSync("ed25519");
  return signerFrom(name, Buffer.from(privateKey.export({ format: "jwk" }).d as string, "base64url"));
}

/** `PRIVATE+KEY+<name>+<id>+<base64(0x01 || seed)>`, the file the signing key lives in. */
export function encodeSigner(s: Signer): string {
  return `PRIVATE+KEY+${s.name}+${s.id.toString("hex")}+${Buffer.concat([Buffer.from([ALG_ED25519]), s.seed]).toString("base64")}`;
}

export function parseSigner(text: string): Signer {
  const parts = text.trim().split("+");
  if (parts.length < 5 || parts[0] !== "PRIVATE" || parts[1] !== "KEY") throw new Error("signer key must be PRIVATE+KEY+<name>+<id>+<key>");
  const raw = Buffer.from(parts.slice(4).join("+"), "base64");
  if (raw.length !== 33 || raw[0] !== ALG_ED25519) throw new Error("signer key is not an Ed25519 key");
  const s = signerFrom(parts[2], raw.subarray(1));
  if (s.id.toString("hex") !== parts[3].toLowerCase()) throw new Error("signer key id does not match the key");
  return s;
}

/** `<name>+<id>+<base64(0x01 || public key)>`, what anyone pins to check the log. */
export function encodeVerifier(v: Verifier): string {
  return `${v.name}+${v.id.toString("hex")}+${Buffer.concat([Buffer.from([ALG_ED25519]), v.publicKey]).toString("base64")}`;
}

export function parseVerifier(text: string): Verifier {
  const [name, id, ...rest] = text.trim().split("+");
  if (!name || !NAME.test(name) || !id || !rest.length) throw new Error("verifier key must be <name>+<id>+<key>");
  const raw = Buffer.from(rest.join("+"), "base64");
  if (raw.length !== 33 || raw[0] !== ALG_ED25519) throw new Error("verifier key is not an Ed25519 key");
  const v = verifierFrom(name, raw.subarray(1));
  if (v.id.toString("hex") !== id.toLowerCase()) throw new Error("verifier key id does not match the key");
  return v;
}

export function signNote(body: string, s: Signer): string {
  if (!body.endsWith("\n") || body.includes("\n\n")) throw new Error("note body must end in a newline and contain no blank line");
  const sig = sign(null, Buffer.from(body), s.privateKey);
  return `${body}\n${SIG_PREFIX}${s.name} ${Buffer.concat([s.id, sig]).toString("base64")}\n`;
}

/** The note's body if `v` signed it; throws otherwise. */
export function openNote(note: string, v: Verifier): string {
  const cut = note.indexOf("\n\n");
  if (cut < 0 || !note.endsWith("\n")) throw new Error("malformed note");
  const body = note.slice(0, cut + 1);
  for (const line of note.slice(cut + 2, -1).split("\n")) {
    if (!line.startsWith(SIG_PREFIX)) throw new Error("malformed signature line");
    const rest = line.slice(SIG_PREFIX.length);
    const space = rest.indexOf(" ");
    if (space < 0) throw new Error("malformed signature line");
    const raw = Buffer.from(rest.slice(space + 1), "base64");
    if (rest.slice(0, space) !== v.name || !raw.subarray(0, 4).equals(v.id)) continue;
    if (raw.length === 68 && verify(null, Buffer.from(body), v.key, raw.subarray(4))) return body;
    throw new Error("bad signature");
  }
  throw new Error(`no signature from ${v.name}`);
}

export interface Checkpoint {
  origin: string;
  size: number;
  root: Buffer;
  timestamp: number;
}

export function checkpointBody(c: Checkpoint): string {
  return `${c.origin}\n${c.size}\n${c.root.toString("base64")}\ntimestamp ${c.timestamp}\n`;
}

/** Checks the signature and the origin, then reads the checkpoint. */
export function openCheckpoint(note: string, v: Verifier): Checkpoint {
  const lines = openNote(note, v).split("\n").slice(0, -1);
  if (lines.length < 3 || lines[0] !== v.name) throw new Error(`checkpoint origin is not ${v.name}`);
  if (!/^(0|[1-9][0-9]*)$/.test(lines[1])) throw new Error("bad tree size");
  const root = Buffer.from(lines[2], "base64");
  if (root.length !== 32 || root.toString("base64") !== lines[2]) throw new Error("bad root hash");
  const stamps = lines.slice(3).filter((l) => l.startsWith("timestamp "));
  if (stamps.length !== 1 || !/^[0-9]+$/.test(stamps[0].slice(10))) throw new Error("checkpoint needs one timestamp line");
  return { origin: lines[0], size: Number(lines[1]), root, timestamp: Number(stamps[0].slice(10)) };
}

/* ---- the tree (RFC 9162 section 2.1, SHA-256) */

export const LEAF_FORMAT = 'leaf data = "d2.desk.event/1\\n" <event hash, 64 lowercase hex> "\\n"';

/** The leaf hash of one Desk event, from its chain hash. */
export function leafHash(eventHash: string): Buffer {
  return sha256(Buffer.from([0x00]), `d2.desk.event/1\n${eventHash}\n`);
}

const node = (l: Buffer, r: Buffer) => sha256(Buffer.from([0x01]), l, r);
const split = (n: number) => 2 ** Math.floor(Math.log2(n - 1));

/** A tree over a list of leaf hashes; whole aligned subtrees are kept, so any prefix's root is cheap. */
export class MerkleTree {
  private memo = new Map<string, Buffer>();
  readonly leaves: Buffer[];
  constructor(leaves: Buffer[]) {
    this.leaves = leaves;
  }

  get size() {
    return this.leaves.length;
  }

  /** MTH(D[lo:lo+n]). */
  hash(lo: number, n: number): Buffer {
    if (n === 0) return sha256("");
    if (n === 1) return this.leaves[lo];
    const perfect = (n & (n - 1)) === 0;
    const key = `${lo}:${n}`;
    if (perfect && this.memo.has(key)) return this.memo.get(key)!;
    const k = split(n);
    const h = node(this.hash(lo, k), this.hash(lo + k, n - k));
    if (perfect) this.memo.set(key, h);
    return h;
  }

  root(n = this.size): Buffer {
    if (n < 0 || n > this.size) throw new RangeError("size out of range");
    return this.hash(0, n);
  }

  /** RFC 9162 section 2.1.4.1: proof that the first m leaves are a prefix of the first n. */
  consistency(m: number, n: number): Buffer[] {
    if (m <= 0 || m > n || n > this.size) throw new RangeError("need 0 < from <= to <= size");
    const sub = (m: number, lo: number, n: number, whole: boolean): Buffer[] => {
      if (m === n) return whole ? [] : [this.hash(lo, n)];
      const k = split(n);
      if (m <= k) return [...sub(m, lo, k, whole), this.hash(lo + k, n - k)];
      return [...sub(m - k, lo + k, n - k, false), this.hash(lo, k)];
    };
    return sub(m, 0, n, true);
  }
}

/** RFC 9162 section 2.1.4.2. */
export function verifyConsistency(m: number, n: number, oldRoot: Buffer, newRoot: Buffer, proof: Buffer[]): boolean {
  if (m <= 0 || m > n) return false;
  if (m === n) return proof.length === 0 && oldRoot.equals(newRoot);
  const path = (m & (m - 1)) === 0 ? [oldRoot, ...proof] : proof;
  if (!path.length) return false;
  let fn = m - 1;
  let sn = n - 1;
  while (fn & 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = path[0];
  let sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn & 1 || fn === sn) {
      fr = node(c, fr);
      sr = node(c, sr);
      if (!(fn & 1)) {
        do {
          fn >>= 1;
          sn >>= 1;
        } while (!(fn & 1) && fn !== 0);
      }
    } else {
      sr = node(sr, c);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && fr.equals(oldRoot) && sr.equals(newRoot);
}

/* ---- OpenTimestamps: a pending receipt from one calendar */

export const DEFAULT_CALENDARS = ["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org", "https://a.pool.eternitywall.com", "https://ots.btc.catallaxy.com"];
const OTS_MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");
const OTS_MAX = 10_000;

/** A detached `.ots` file over the note: header, version 1, SHA-256 of the note, the calendar's answer. */
export function otsFile(digest: Buffer, calendarAnswer: Buffer): Buffer {
  return Buffer.concat([OTS_MAGIC, Buffer.from([0x01, 0x08]), digest, calendarAnswer]);
}

/** Asks the calendars in turn; the first that answers gives the receipt. */
export async function stampDigest(digest: Buffer, calendars: string[], fetcher: typeof fetch = fetch): Promise<{ ots: Buffer; calendar: string }> {
  const errors: string[] = [];
  for (const cal of calendars) {
    try {
      const res = await fetcher(`${cal.replace(/\/+$/, "")}/digest`, {
        method: "POST",
        headers: { accept: "application/vnd.opentimestamps.v1", "user-agent": "d2-desk (+https://github.com/7empes7s/demo2.0)" },
        body: new Uint8Array(digest),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const answer = Buffer.from(await res.arrayBuffer());
      if (!answer.length || answer.length > OTS_MAX) throw new Error("answer is empty or too large");
      return { ots: otsFile(digest, answer), calendar: cal };
    } catch (e) {
      errors.push(`${cal}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`no calendar answered: ${errors.join("; ")}`);
}

/* ---- the daily fingerprints */

export interface FingerprintRow {
  day: string;
  size: number;
  root: string;
  note: string;
  signed_at: string;
  ots: Uint8Array | null;
  ots_calendar: string | null;
}

export class Fingerprints {
  private tree: MerkleTree | null = null;
  /** The log head the cached tree was built at: a rewrite that keeps the count changes the head. */
  private treeHead = "";
  readonly store: Store;
  readonly signer: Signer;
  readonly opts: { calendars?: string[]; fetcher?: typeof fetch };

  constructor(store: Store, signer: Signer, opts: { calendars?: string[]; fetcher?: typeof fetch } = {}) {
    this.store = store;
    this.signer = signer;
    this.opts = opts;
  }

  get verifierKey(): string {
    return encodeVerifier(this.signer);
  }

  /** The tree over the whole log as it is now; rebuilt when the log has grown. */
  currentTree(): MerkleTree {
    const head = this.store.head();
    if (this.tree?.size !== head.seq || this.treeHead !== head.hash) {
      const rows = this.store.db.prepare("SELECT hash FROM events ORDER BY seq ASC").all() as { hash: string }[];
      this.tree = new MerkleTree(rows.map((r) => leafHash(r.hash)));
      this.treeHead = head.hash;
    }
    return this.tree;
  }

  /** Signs today's (UTC) checkpoint unless there is one. Refuses on a broken chain. */
  signDue(): FingerprintRow | null {
    const now = this.store.now();
    const day = now.slice(0, 10);
    if (this.store.db.prepare("SELECT 1 FROM fingerprints WHERE day = ?").get(day)) return null;
    const check = this.store.verify();
    if (!check.ok) throw new Error(`the log is broken at entry ${check.broken_at}; no fingerprint signed`);
    const tree = this.currentTree();
    if (tree.size !== check.entries) throw new Error("the log changed while it was being fingerprinted");
    const root = tree.root();
    const note = signNote(checkpointBody({ origin: this.signer.name, size: tree.size, root, timestamp: Math.floor(Date.parse(now) / 1000) }), this.signer);
    this.store.db.prepare("INSERT INTO fingerprints (day, size, root, note, signed_at) VALUES (?, ?, ?, ?, ?)").run(day, tree.size, root.toString("base64"), note, now);
    return this.get(day);
  }

  /** Sends every checkpoint without a receipt to a calendar. Returns how many got one. */
  async anchorPending(): Promise<number> {
    const calendars = this.opts.calendars ?? DEFAULT_CALENDARS;
    if (!calendars.length) return 0;
    const rows = this.store.db.prepare("SELECT day, note FROM fingerprints WHERE ots IS NULL ORDER BY day ASC").all() as { day: string; note: string }[];
    let done = 0;
    for (const r of rows) {
      const { ots, calendar } = await stampDigest(sha256(r.note), calendars, this.opts.fetcher);
      this.store.db.prepare("UPDATE fingerprints SET ots = ?, ots_calendar = ? WHERE day = ? AND ots IS NULL").run(ots, calendar, r.day);
      done++;
    }
    return done;
  }

  /**
   * A tree covering every published size, for the public proofs. Entries never change, so the
   * tree built at signing time serves until the next day; a busy log costs no rebuild per request.
   */
  publishedTree(): MerkleTree {
    const max = (this.store.db.prepare("SELECT MAX(size) AS n FROM fingerprints").get() as { n: number | null }).n ?? 0;
    if (!this.tree || this.tree.size < max) this.currentTree();
    return this.tree!;
  }

  get(day: string): FingerprintRow | null {
    return (this.store.db.prepare("SELECT * FROM fingerprints WHERE day = ?").get(day) as FingerprintRow | undefined) ?? null;
  }

  all(): FingerprintRow[] {
    return this.store.db.prepare("SELECT * FROM fingerprints ORDER BY day ASC").all() as unknown as FingerprintRow[];
  }

  /** For the auditor: does every published root match the log as it is now? */
  audit(): { checked: number; ok: boolean; mismatch_day: string | null } {
    const rows = this.all();
    const tree = this.currentTree();
    for (const r of rows) {
      if (r.size > tree.size || tree.root(r.size).toString("base64") !== r.root) return { checked: rows.length, ok: false, mismatch_day: r.day };
    }
    return { checked: rows.length, ok: true, mismatch_day: null };
  }
}

/** The public view of one day: no database columns beyond what the checkpoint says. */
export function publicDay(r: FingerprintRow) {
  return {
    day: r.day,
    size: r.size,
    root: r.root,
    signed_at: r.signed_at,
    note: r.note,
    note_sha256: sha256(r.note).toString("hex"),
    ots: r.ots ? Buffer.from(r.ots).toString("base64") : null,
    ots_calendar: r.ots_calendar,
  };
}
