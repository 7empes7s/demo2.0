// drand beacons, written from spec/lottery/README.md section 4.
// BLS12-381 comes from @noble/curves (audited, pure TypeScript); nothing is shared with
// modules/lottery, which uses a different BLS library in a different language.

import { createHash } from "node:crypto";

import { bls12_381 as bls } from "@noble/curves/bls12-381.js";

export class VerifyError extends Error {}

export function fail(message: string): never {
  throw new VerifyError(message);
}

export const UNCHAINED_G1 = "bls-unchained-g1-rfc9380";
export const CHAINED = "pedersen-bls-chained";
const DST_G1 = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
const DST_G2 = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_";

export const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

export function hexBytes(value: unknown, size: number, what: string): Buffer {
  if (typeof value !== "string" || !/^[0-9a-f]*$/.test(value) || value.length !== size * 2) {
    fail(`${what} must be ${size} bytes of lowercase hex`);
  }
  return Buffer.from(value, "hex");
}

export function uint(value: unknown, what: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    fail(`${what} must be an integer >= ${min}`);
  }
  return value;
}

export function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

export function u64be(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

export interface ChainInfo {
  public_key: string;
  period: number;
  genesis_time: number;
  group_hash: string;
  scheme: string;
  beacon_id: string;
}

/** Accepts the spec's field names or drand's own /info JSON. */
export function parseChainInfo(raw: unknown): ChainInfo {
  if (typeof raw !== "object" || raw === null) fail("chain info must be an object");
  const r = raw as Record<string, unknown>;
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const info = {
    public_key: r.public_key,
    period: r.period,
    genesis_time: r.genesis_time,
    group_hash: r.group_hash ?? r.groupHash,
    scheme: r.scheme ?? r.schemeID,
    beacon_id: r.beacon_id ?? meta.beaconID,
  };
  if (info.scheme !== UNCHAINED_G1 && info.scheme !== CHAINED) fail(`unsupported scheme ${String(info.scheme)}`);
  hexBytes(info.public_key, info.scheme === UNCHAINED_G1 ? 96 : 48, "public_key");
  hexBytes(info.group_hash, 32, "group_hash");
  uint(info.period, "period", 1);
  uint(info.genesis_time, "genesis_time");
  if (typeof info.beacon_id !== "string" || info.beacon_id === "") fail("beacon_id must be a non-empty string");
  return info as ChainInfo;
}

export function chainHash(c: ChainInfo): string {
  return sha256(
    u32be(c.period),
    u64be(c.genesis_time),
    Buffer.from(c.public_key, "hex"),
    Buffer.from(c.group_hash, "hex"),
    c.beacon_id === "default" ? Buffer.alloc(0) : Buffer.from(c.beacon_id, "utf8"),
  ).toString("hex");
}

export const roundTime = (c: ChainInfo, round: number): number => c.genesis_time + (round - 1) * c.period;

/** League of Entropy mainnet chains. Their hashes are recomputed and checked by the tests. */
export const KNOWN_CHAINS: Record<string, ChainInfo> = {
  quicknet: {
    public_key:
      "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
    period: 3,
    genesis_time: 1692803367,
    group_hash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
    scheme: UNCHAINED_G1,
    beacon_id: "quicknet",
  },
  default: {
    public_key: "868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31",
    period: 30,
    genesis_time: 1595431050,
    group_hash: "176f93498eac9ca337150b46d21dd58673ea4e3581185f869672e59fa4cb390a",
    scheme: CHAINED,
    beacon_id: "default",
  },
};

export interface Beacon {
  round: number;
  randomness: string;
  signature: string;
  previous_signature?: string;
}

/** Spec section 4: returns the 32-byte randomness, or throws VerifyError. */
export function verifyBeacon(chain: ChainInfo, beacon: unknown, expectedRound: number): Buffer {
  if (typeof beacon !== "object" || beacon === null) fail("beacon must be an object");
  const b = beacon as Record<string, unknown>;
  const round = uint(b.round, "beacon round", 1);
  if (round !== expectedRound) fail(`beacon is round ${round}, the commitment names ${expectedRound}`);
  let ok: boolean;
  let sig: Buffer;
  try {
    if (chain.scheme === UNCHAINED_G1) {
      if (b.previous_signature !== undefined) fail("an unchained beacon has no previous_signature");
      sig = hexBytes(b.signature, 48, "signature");
      const S = bls.shortSignatures;
      const point = S.Signature.fromBytes(sig);
      ok = S.verify(point, S.hash(sha256(u64be(round)), DST_G1), Buffer.from(chain.public_key, "hex"));
    } else {
      sig = hexBytes(b.signature, 96, "signature");
      const prev = hexBytes(b.previous_signature, 96, "previous_signature");
      const L = bls.longSignatures;
      const point = L.Signature.fromBytes(sig);
      ok = L.verify(point, L.hash(sha256(prev, u64be(round)), DST_G2), Buffer.from(chain.public_key, "hex"));
    }
  } catch (err) {
    if (err instanceof VerifyError) throw err;
    fail(`malformed BLS point: ${(err as Error).message}`);
  }
  const randomness = hexBytes(b.randomness, 32, "randomness");
  if (!randomness.equals(sha256(sig))) fail("randomness is not SHA-256(signature)");
  if (!ok) fail("BLS signature does not verify under the chain's public key");
  return randomness;
}

export type Fetch = (url: string) => Promise<string>;

/** Fetch one round from a drand relay. The caller still verifies it with verifyBeacon. */
export async function fetchBeacon(chain: ChainInfo, round: number, baseUrl: string, get: Fetch): Promise<unknown> {
  return JSON.parse(await get(`${baseUrl.replace(/\/+$/, "")}/${chainHash(chain)}/public/${round}`));
}
