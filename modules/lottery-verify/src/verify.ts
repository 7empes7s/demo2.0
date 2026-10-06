// Independent Lottery verifier, written from spec/lottery/README.md alone.
// It shares no code with modules/lottery: pool hashing, the commitment encoding, the random
// stream and the shuffle are reimplemented here, so a bug in one does not hide in the other.

import { isDeepStrictEqual } from "node:util";

import { chainHash, fail, KNOWN_CHAINS, roundTime, sha256, uint, u64be, verifyBeacon, VerifyError, type ChainInfo } from "./drand.ts";

export { VerifyError } from "./drand.ts";

const NYM = /^[A-Za-z0-9+/=_.:-]{1,256}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const MIN_SEED_DELAY = 3600;

/** Spec section 7, step 0: printed with every success until transcripts cite their Record entry. */
export const UNANCHORED_WARNING =
  "warning: commit time not anchored to Record; a backdated commitment cannot be detected";

const INTEGER_LITERAL = /^-?(0|[1-9][0-9]*)$/;

/**
 * JSON.parse that refuses numbers not written as plain decimal integers (spec section 7,
 * "Strict input"): `2634945.0` and `2e1` parse to integers in JavaScript, so the text is checked.
 */
export function parseJson(text: string): unknown {
  type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
  const reviver: Reviver = (_key, value, context) => {
    if (typeof value === "number" && (context?.source === undefined || !INTEGER_LITERAL.test(context.source))) {
      fail(`number ${context?.source ?? String(value)} is not a decimal integer`);
    }
    return value;
  };
  try {
    return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
  } catch (err) {
    if (err instanceof VerifyError) throw err;
    fail(`not JSON: ${(err as Error).message}`);
  }
}

const ascii = (s: string): Buffer => Buffer.from(s, "ascii");
const bytewise = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0); // ASCII only

function match(re: RegExp, value: unknown, what: string): string {
  if (typeof value !== "string" || !re.test(value)) fail(`bad ${what} ${JSON.stringify(value)}`);
  return value;
}

// --- Pool (section 2) -------------------------------------------------------------------

export interface Member {
  nym: string;
  strata: Record<string, string>;
}

export function parseMember(raw: unknown): Member {
  if (typeof raw !== "object" || raw === null) fail("a member is an object");
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== "nym" && k !== "strata") fail(`unknown member field ${k}`);
  const nym = match(NYM, r.nym, "pseudonym");
  const strata = (r.strata === undefined ? {} : r.strata) as Record<string, unknown>;
  if (typeof strata !== "object" || strata === null || Array.isArray(strata)) fail("strata must be an object");
  const out: Record<string, string> = {};
  for (const key of Object.keys(strata).sort(bytewise)) {
    out[match(TOKEN, key, "stratum key")] = match(TOKEN, strata[key], "stratum value");
  }
  return { nym, strata: out };
}

export function leafData(m: Member): Buffer {
  const lines = Object.keys(m.strata)
    .sort(bytewise)
    .map((k) => `${k}=${m.strata[k]}\n`);
  return ascii(`d2.lottery.member/1\n${m.nym}\n${lines.join("")}`);
}

const leafHash = (data: Uint8Array): Buffer => sha256(Buffer.of(0), data);
const nodeHash = (l: Uint8Array, r: Uint8Array): Buffer => sha256(Buffer.of(1), l, r);

function mth(leaves: Buffer[]): Buffer {
  if (leaves.length === 1) return leaves[0]!;
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/** Members in canonical order (bytewise by pseudonym) and the pool root. */
export function poolRoot(raw: unknown): { members: Member[]; root: string } {
  if (!Array.isArray(raw) || raw.length === 0) fail("the pool is a non-empty list");
  const members = raw.map(parseMember).sort((a, b) => bytewise(a.nym, b.nym));
  for (let i = 1; i < members.length; i++) {
    if (members[i]!.nym === members[i - 1]!.nym) fail(`pseudonym ${members[i]!.nym} appears twice`);
  }
  return { members, root: mth(members.map((m) => leafHash(leafData(m)))).toString("hex") };
}

/** RFC 9162 section 2.1.3.2: is the member in a pool with this root and size? */
export function checkMemberInclusion(root: string, size: number, proof: unknown): void {
  if (typeof proof !== "object" || proof === null) fail("proof must be an object");
  const p = proof as Record<string, unknown>;
  if (p.size !== size) fail(`proof is for a pool of ${String(p.size)}, the commitment says ${size}`);
  const index = uint(p.index, "index");
  if (index >= size) fail("index out of range");
  if (!Array.isArray(p.proof)) fail("proof.proof must be a list");
  const path = p.proof.map((h) => Buffer.from(match(HASH, h, "proof hash"), "hex"));
  let fn = BigInt(index);
  let sn = BigInt(size - 1);
  let r = leafHash(leafData(parseMember(p.member)));
  for (const h of path) {
    if (sn === 0n) fail("proof too long");
    if ((fn & 1n) === 1n || fn === sn) {
      r = nodeHash(h, r);
      if ((fn & 1n) === 0n) {
        while (fn !== 0n && (fn & 1n) === 0n) {
          fn >>= 1n;
          sn >>= 1n;
        }
      }
    } else {
      r = nodeHash(r, h);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  if (sn !== 0n || r.toString("hex") !== root) fail("member is not in the pool with that root");
}

// --- Commitment (section 3) -------------------------------------------------------------

export interface Commitment {
  purpose: string;
  context: string;
  committed_at: number;
  pool_root: string;
  pool_size: number;
  chain: string;
  scheme: string;
  round: number;
  size: number;
  stratify_by: string | null;
  quotas: Record<string, number>;
}

const COMMITMENT_FIELDS = [
  "version",
  "purpose",
  "context",
  "committed_at",
  "pool_root",
  "pool_size",
  "chain",
  "scheme",
  "round",
  "size",
  "stratify_by",
  "quotas",
];

export function parseCommitment(raw: unknown): Commitment {
  if (typeof raw !== "object" || raw === null) fail("the commitment is an object");
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!COMMITMENT_FIELDS.includes(k)) fail(`unknown commitment field ${k}`);
  if (r.version !== undefined && r.version !== "d2.lottery.draw/1") fail(`unsupported version ${String(r.version)}`);
  const c: Commitment = {
    purpose: match(LABEL, r.purpose, "purpose"),
    context: match(LABEL, r.context, "context"),
    committed_at: uint(r.committed_at, "committed_at"),
    pool_root: match(HASH, r.pool_root, "pool_root"),
    pool_size: uint(r.pool_size, "pool_size", 1),
    chain: match(HASH, r.chain, "chain"),
    scheme: match(TOKEN, r.scheme, "scheme"),
    round: uint(r.round, "round", 1),
    size: uint(r.size, "size", 1),
    stratify_by: r.stratify_by === null || r.stratify_by === undefined ? null : match(TOKEN, r.stratify_by, "stratify_by"),
    quotas: {},
  };
  if (c.size > c.pool_size) fail("panel size exceeds pool size");
  const quotas = (r.quotas === undefined ? {} : r.quotas) as Record<string, unknown>;
  if (typeof quotas !== "object" || quotas === null || Array.isArray(quotas)) fail("quotas must be an object");
  let sum = 0;
  for (const value of Object.keys(quotas).sort(bytewise)) {
    c.quotas[match(TOKEN, value, "stratum value")] = uint(quotas[value], `quota for ${value}`);
    sum += c.quotas[value]!;
  }
  const n = Object.keys(c.quotas).length;
  if (c.stratify_by === null && n > 0) fail("quotas need stratify_by");
  if (c.stratify_by !== null && n === 0) fail("stratify_by needs quotas");
  if (c.stratify_by !== null && sum !== c.size) fail(`quotas sum to ${sum}, size is ${c.size}`);
  return c;
}

export function commitmentText(c: Commitment): string {
  const lines = [
    "d2.lottery.draw/1",
    `purpose ${c.purpose}`,
    `context ${c.context}`,
    `committed-at ${c.committed_at}`,
    `pool ${c.pool_root}`,
    `pool-size ${c.pool_size}`,
    `chain ${c.chain}`,
    `scheme ${c.scheme}`,
    `round ${c.round}`,
    `size ${c.size}`,
    `stratify-by ${c.stratify_by ?? "-"}`,
    ...Object.keys(c.quotas)
      .sort(bytewise)
      .map((v) => `quota ${v} ${c.quotas[v]}`),
  ];
  return lines.map((l) => l + "\n").join("");
}

export const commitmentHash = (c: Commitment): Buffer => sha256(ascii(commitmentText(c)));

// --- Stream and draw (section 5) --------------------------------------------------------

const TWO64 = 1n << 64n;

export class Stream {
  private counter = 0n;
  private buf: Buffer = Buffer.alloc(0);
  private readonly seed: Buffer;
  constructor(seed: Buffer) {
    if (seed.length !== 32) fail("seed must be 32 bytes");
    this.seed = seed;
  }

  u64(): bigint {
    if (this.buf.length === 0) {
      this.buf = sha256(ascii("d2.lottery.stream/1\n"), this.seed, u64be(this.counter));
      this.counter += 1n;
    }
    const x = this.buf.readBigUInt64BE(0);
    this.buf = this.buf.subarray(8);
    return x;
  }

  below(n: bigint): bigint {
    if (n < 1n) fail("range must be at least 1");
    const limit = TWO64 - (TWO64 % n);
    for (;;) {
      const x = this.u64();
      if (x < limit) return x % n;
    }
  }
}

export const drawSeed = (c: Commitment, randomness: Buffer): Buffer =>
  sha256(ascii("d2.lottery.seed/1\n"), commitmentHash(c), randomness);

export interface Group {
  stratum: string | null;
  quota: number;
  order: string[];
}

export interface Result {
  commitment_hash: string;
  groups: Group[];
  selected: string[];
}

function strata(c: Commitment, members: Member[]): Group[] {
  if (c.stratify_by === null) return [{ stratum: null, quota: c.size, order: members.map((m) => m.nym) }];
  const key = c.stratify_by;
  const groups: Group[] = Object.keys(c.quotas)
    .sort(bytewise)
    .map((v) => ({ stratum: v, quota: c.quotas[v]!, order: [] }));
  const byValue = new Map(groups.map((g) => [g.stratum, g]));
  for (const m of members) {
    const value = m.strata[key];
    if (value === undefined) fail(`${m.nym} has no ${key}`);
    const g = byValue.get(value);
    if (g === undefined) fail(`no quota for ${key}=${value}`);
    g.order.push(m.nym);
  }
  for (const g of groups) {
    if (g.order.length === 0) fail(`quota for ${key}=${g.stratum} but nobody has it`);
    if (g.quota > g.order.length) fail(`quota ${g.quota} for ${g.stratum} exceeds its ${g.order.length} members`);
  }
  return groups;
}

export function runDraw(c: Commitment, members: Member[], randomness: Buffer): Result {
  const stream = new Stream(drawSeed(c, randomness));
  const groups = strata(c, members);
  for (const g of groups) {
    const a = g.order;
    for (let i = 0; i < a.length - 1; i++) {
      const j = i + Number(stream.below(BigInt(a.length - i)));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
  }
  return {
    commitment_hash: commitmentHash(c).toString("hex"),
    groups,
    selected: groups.flatMap((g) => g.order.slice(0, g.quota)),
  };
}

/** Section 6: per stratum, the first `quota` of its order that nobody in `declined` holds. */
export function panelAfter(result: Result, declined: Iterable<string>): { members: string[]; short: number } {
  const out = new Set(declined);
  const members: string[] = [];
  let short = 0;
  for (const g of result.groups) {
    const taken = g.order.filter((n) => !out.has(n)).slice(0, g.quota);
    members.push(...taken);
    short += g.quota - taken.length;
  }
  return { members, short };
}

// --- Transcript (section 7) -------------------------------------------------------------

/** Chains trusted by hash: the mainnet ones, plus any the caller adds explicitly. */
export function trustedChains(extra: ChainInfo[] = []): Map<string, ChainInfo> {
  return new Map([...Object.values(KNOWN_CHAINS), ...extra].map((c) => [chainHash(c), c]));
}

export function verifyTranscript(transcript: unknown, trusted = trustedChains()): Result {
  if (typeof transcript !== "object" || transcript === null) fail("the transcript is an object");
  const t = transcript as Record<string, unknown>;
  const c = parseCommitment(t.commitment);
  const { members, root } = poolRoot(t.pool);
  if (root !== c.pool_root || members.length !== c.pool_size) fail("pool does not match the committed root and size");
  const chain = trusted.get(c.chain);
  if (chain === undefined) fail(`chain ${c.chain} is not a trusted drand chain`);
  if (chain.scheme !== c.scheme) fail("committed scheme differs from the chain's");
  // Spec section 7: exactly the six spec fields, each equal in JSON type and value.
  if (t.chain_info !== undefined && !isDeepStrictEqual(t.chain_info, chain)) {
    fail("chain_info differs from the trusted chain");
  }
  if (roundTime(chain, c.round) < c.committed_at + MIN_SEED_DELAY) {
    fail(`round ${c.round} is produced before committed_at + ${MIN_SEED_DELAY}s`);
  }
  const randomness = verifyBeacon(chain, t.beacon, c.round);
  const result = runDraw(c, members, randomness);
  if (t.result !== undefined && !isDeepStrictEqual(t.result, result)) {
    fail("published result differs from the recomputed draw");
  }
  return result;
}
