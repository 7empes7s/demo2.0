// Independent verifier for Record proofs, written from spec/record/README.md.
// It shares no code with modules/record: hashing, proof checks and signed notes are
// reimplemented here so a bug in one implementation does not hide in the other.

import { createHash, createPublicKey, verify as ed25519Verify, type KeyObject } from "node:crypto";

export class VerifyError extends Error {}

function fail(message: string): never {
  throw new VerifyError(message);
}

// --- Hashing (RFC 9162 section 2.1) ---------------------------------------------------

function sha256(...parts: Uint8Array[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

export const leafHash = (data: Uint8Array): Buffer => sha256(Buffer.of(0x00), data);
export const nodeHash = (left: Uint8Array, right: Uint8Array): Buffer => sha256(Buffer.of(0x01), left, right);

const isOdd = (n: bigint) => (n & 1n) === 1n;

/** RFC 9162 section 2.1.3.2. Returns the root the proof leads to, or null if malformed. */
export function rootFromInclusion(index: bigint, size: bigint, leaf: Buffer, proof: Buffer[]): Buffer | null {
  if (index < 0n || index >= size) return null;
  let fn = index;
  let sn = size - 1n;
  let r = leaf;
  for (const p of proof) {
    if (p.length !== 32 || sn === 0n) return null;
    if (isOdd(fn) || fn === sn) {
      r = nodeHash(p, r);
      while (!isOdd(fn) && fn !== 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n ? r : null;
}

export function verifyInclusion(index: bigint, size: bigint, leaf: Buffer, proof: Buffer[], root: Buffer): boolean {
  const r = rootFromInclusion(index, size, leaf, proof);
  return r !== null && r.equals(root);
}

/** RFC 9162 section 2.1.4.2. */
export function verifyConsistency(
  first: bigint,
  second: bigint,
  firstRoot: Buffer,
  secondRoot: Buffer,
  proof: Buffer[],
): boolean {
  if (first <= 0n || first > second) return false;
  if (first === second) return proof.length === 0 && firstRoot.equals(secondRoot);
  if (proof.some((p) => p.length !== 32)) return false;
  const path = (first & (first - 1n)) === 0n ? [firstRoot, ...proof] : [...proof];
  if (path.length === 0) return false;
  let fn = first - 1n;
  let sn = second - 1n;
  while (isOdd(fn)) {
    fn >>= 1n;
    sn >>= 1n;
  }
  let fr = path[0];
  let sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0n) return false;
    if (isOdd(fn) || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      while (!isOdd(fn) && fn !== 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n && fr.equals(firstRoot) && sr.equals(secondRoot);
}

// --- Encodings ---------------------------------------------------------------------------

export function base64(value: unknown, what: string): Buffer {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail(`${what} is not standard base64`);
  }
  return Buffer.from(value, "base64");
}

function hashList(value: unknown): Buffer[] {
  if (!Array.isArray(value)) fail("proof hashes must be a list");
  return value.map((h, i) => base64(h, `proof hash ${i}`));
}

function count(value: unknown, what: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${what} must be a whole number`);
  return BigInt(value);
}

// --- Keys and signed notes (spec section 3) ------------------------------------------------

export interface VerifierKey {
  name: string;
  id: Buffer;
  key: KeyObject;
  /** The canonical encoding: <name>+<lowercase id>+<base64 key>. */
  encoded: string;
}

/** Parses a verifier key exactly as given; callers trim text read from files. */
export function parseVerifierKey(s: string): VerifierKey {
  const a = s.indexOf("+");
  const b = s.indexOf("+", a + 1);
  if (a <= 0 || b < 0) fail("verifier key must be <name>+<id>+<key>");
  const name = s.slice(0, a);
  if (/\s/.test(name)) fail("verifier key name has whitespace");
  const raw = base64(s.slice(b + 1), "verifier key");
  if (raw.length !== 33 || raw[0] !== 0x01) fail("verifier key is not an Ed25519 key");
  const pub = raw.subarray(1);
  const id = sha256(Buffer.from(name + "\n"), Buffer.of(0x01), pub).subarray(0, 4);
  if (id.toString("hex") !== s.slice(a + 1, b).toLowerCase()) fail("verifier key id does not match the key");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pub.toString("base64url") }, format: "jwk" });
  return { name, id, key, encoded: `${name}+${id.toString("hex")}+${raw.toString("base64")}` };
}

const ed25519 = (key: KeyObject, message: Uint8Array, sig: Buffer): boolean =>
  sig.length === 64 && ed25519Verify(null, message, key, sig);

/** Returns the note body if `v` signed it; throws otherwise. */
export function openNote(note: string, v: VerifierKey): string {
  const split = note.indexOf("\n\n");
  if (split < 0 || !note.endsWith("\n")) fail("malformed note");
  const body = note.slice(0, split + 1);
  for (const line of note.slice(split + 2, -1).split("\n")) {
    if (!line.startsWith("— ")) fail("malformed signature line");
    const rest = line.slice(2);
    const space = rest.indexOf(" ");
    if (space < 0) fail("malformed signature line");
    const raw = base64(rest.slice(space + 1), "signature");
    if (rest.slice(0, space) !== v.name || raw.length < 4 || !raw.subarray(0, 4).equals(v.id)) continue;
    if (ed25519(v.key, Buffer.from(body, "utf8"), raw.subarray(4))) return body;
    fail("bad checkpoint signature");
  }
  fail(`no signature from ${v.name}`);
}

export interface Checkpoint {
  origin: string;
  size: bigint;
  root: Buffer;
  timestamp: number;
}

export function parseCheckpoint(body: string): Checkpoint {
  const lines = body.split("\n").slice(0, -1);
  if (lines.length < 3 || lines[0] === "") fail("checkpoint needs origin, size and root lines");
  if (!/^(0|[1-9][0-9]*)$/.test(lines[1])) fail("bad tree size");
  const root = base64(lines[2], "root hash");
  if (root.length !== 32) fail("bad root hash");
  const stamps = lines.slice(3).filter((l) => l.startsWith("timestamp "));
  if (stamps.length !== 1 || !/^[0-9]+$/.test(stamps[0].slice(10))) fail("checkpoint needs one timestamp line");
  return { origin: lines[0], size: BigInt(lines[1]), root, timestamp: Number(stamps[0].slice(10)) };
}

export function verifyCheckpoint(note: string, v: VerifierKey): Checkpoint {
  const cp = parseCheckpoint(openNote(note, v));
  if (cp.origin !== v.name) fail(`checkpoint origin ${cp.origin} is not the key name ${v.name}`);
  return cp;
}

// --- Entries (spec section 1) ---------------------------------------------------------------

export interface Entry {
  type: string;
  payload_hash: string;
  payload_uri: string;
  signer: string;
  signature: string;
}

const FIELDS = ["type", "payload_hash", "payload_uri", "signer", "signature"] as const;

export function checkEntry(value: unknown): Entry {
  if (typeof value !== "object" || value === null) fail("entry must be an object");
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.join() !== [...FIELDS].sort().join()) fail(`entry must have exactly ${FIELDS.join(", ")}`);
  for (const f of FIELDS) if (typeof obj[f] !== "string") fail(`entry ${f} must be a string`);
  const e = obj as unknown as Entry;
  // Lone UTF-16 surrogates have no UTF-8 encoding; Buffer.from would silently replace them.
  for (const f of FIELDS) if (/\p{Cs}/u.test(e[f])) fail(`entry ${f} is not valid UTF-8 text`);
  // JavaScript's "$" (without the m flag) matches only at the very end, never before a final "\n".
  if (!/^[^\x00-\x20\x7f]{1,128}$/u.test(e.type)) fail("bad entry type");
  if (!/^sha256:[0-9a-f]{64}$/.test(e.payload_hash)) fail("payload_hash must be sha256:<64 lowercase hex>");
  if (!/^[^\x00-\x20\x7f]{1,2048}$/u.test(e.payload_uri)) fail("bad payload_uri");
  const signer = parseVerifierKey(e.signer);
  if (signer.encoded !== e.signer) fail("signer must be a verifier key in canonical form");
  const message = `d2.record.entry-signature/1\n${e.type}\n${e.payload_hash}\n${e.payload_uri}\n`;
  if (!ed25519(signer.key, Buffer.from(message, "utf8"), base64(e.signature, "entry signature"))) {
    fail("entry signature does not verify");
  }
  return e;
}

export const entryLeafData = (e: Entry): Buffer =>
  Buffer.from(`d2.record.entry/1\n${FIELDS.map((f) => e[f] + "\n").join("")}`, "utf8");

// --- Whole checks (spec section 5) ----------------------------------------------------------

export interface InclusionCase {
  checkpoint: string;
  entry: unknown;
  proof: { seq?: unknown; size?: unknown; leaf_hash?: unknown; proof?: unknown };
}

export interface ConsistencyCase {
  old: string;
  new: string;
  proof: { from?: unknown; to?: unknown; proof?: unknown };
}

export function checkInclusion(c: InclusionCase, vkey: VerifierKey): Checkpoint {
  const cp = verifyCheckpoint(c.checkpoint, vkey);
  const entry = checkEntry(c.entry);
  const size = count(c.proof.size, "proof size");
  if (size !== cp.size) fail(`proof is for size ${size}, checkpoint is ${cp.size}`);
  const seq = count(c.proof.seq, "proof seq");
  const leaf = leafHash(entryLeafData(entry));
  if (c.proof.leaf_hash !== undefined && !base64(c.proof.leaf_hash, "leaf_hash").equals(leaf)) {
    fail("leaf hash in proof does not match the entry");
  }
  if (!verifyInclusion(seq, size, leaf, hashList(c.proof.proof), cp.root)) {
    fail("inclusion proof does not lead to the checkpoint root");
  }
  return cp;
}

export function checkConsistency(c: ConsistencyCase, vkey: VerifierKey): void {
  const oldCp = verifyCheckpoint(c.old, vkey);
  const newCp = verifyCheckpoint(c.new, vkey);
  if (oldCp.origin !== newCp.origin) fail("checkpoints are from different logs");
  if (count(c.proof.from, "proof from") !== oldCp.size || count(c.proof.to, "proof to") !== newCp.size) {
    fail("proof sizes do not match the checkpoints");
  }
  if (!verifyConsistency(oldCp.size, newCp.size, oldCp.root, newCp.root, hashList(c.proof.proof))) {
    fail("consistency proof does not hold");
  }
}
