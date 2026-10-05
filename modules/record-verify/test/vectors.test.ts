import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  checkConsistency,
  checkInclusion,
  entryLeafData,
  checkEntry,
  leafHash,
  nodeHash,
  parseVerifierKey,
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
  type ConsistencyCase,
  type InclusionCase,
} from "../src/verify.ts";

const vectors = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../spec/record/vectors/${name}`, import.meta.url), "utf8"));
const RFC = vectors("rfc6962.json");
const D2 = vectors("d2-log.json");
const hex = (h: string) => Buffer.from(h, "hex");

// RFC 6962 section 2.1, as literally as possible, to check roots independently of the proofs.
function mth(leaves: Buffer[]): Buffer {
  if (leaves.length === 1) return leaves[0];
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

describe("RFC 6962 reference vectors", () => {
  const leaves = (RFC.leaves as string[]).map((l) => leafHash(hex(l)));

  it("computes the reference roots", () => {
    for (const [size, root] of Object.entries(RFC.roots as Record<string, string>)) {
      expect(mth(leaves.slice(0, Number(size))).toString("hex")).toBe(root);
    }
  });

  it.each(RFC.inclusion as { index: number; size: number; proof: string[] }[])(
    "inclusion of $index in $size",
    ({ index, size, proof }) => {
      const root = hex(RFC.roots[String(size)]);
      const p = proof.map(hex);
      expect(verifyInclusion(BigInt(index), BigInt(size), leaves[index], p, root)).toBe(true);
      expect(verifyInclusion(BigInt(index), BigInt(size), leafHash(Buffer.from("x")), p, root)).toBe(false);
      expect(verifyInclusion(BigInt(index), BigInt(size), leaves[index], [...p, root], root)).toBe(false);
    },
  );

  it.each(RFC.consistency as { from: number; to: number; proof: string[] }[])(
    "consistency $from to $to",
    ({ from, to, proof }) => {
      const [a, b] = [hex(RFC.roots[String(from)]), hex(RFC.roots[String(to)])];
      const p = proof.map(hex);
      expect(verifyConsistency(BigInt(from), BigInt(to), a, b, p)).toBe(true);
      if (from !== to) {
        expect(verifyConsistency(BigInt(from), BigInt(to), b, a, p)).toBe(false);
        expect(verifyConsistency(BigInt(from), BigInt(to), a, b, p.slice(0, -1))).toBe(false);
      }
    },
  );
});

describe("Record vectors", () => {
  const vkey = parseVerifierKey(D2.vkey);
  const cp = (size: number): string => D2.checkpoints[String(size)];

  it("encodes leaves as the spec says", () => {
    const entry = checkEntry(D2.entries[0]);
    expect(entryLeafData(entry).toString("utf8")).toBe(D2.leaf_data_0);
    expect(leafHash(entryLeafData(entry)).toString("base64")).toBe(D2.inclusion[0].leaf_hash);
  });

  it("verifies every checkpoint", () => {
    for (const [size, note] of Object.entries(D2.checkpoints as Record<string, string>)) {
      expect(verifyCheckpoint(note, vkey).size).toBe(BigInt(size));
    }
  });

  it("verifies every inclusion proof", () => {
    for (const proof of D2.inclusion) {
      checkInclusion({ checkpoint: cp(proof.size), entry: D2.entries[proof.seq], proof }, vkey);
    }
    expect(D2.inclusion.length).toBe(91);
  });

  it("verifies every consistency proof", () => {
    for (const proof of D2.consistency) {
      checkConsistency({ old: cp(proof.from), new: cp(proof.to), proof }, vkey);
    }
    expect(D2.consistency.length).toBe(91);
  });

  it.each(D2.invalid as ({ kind: string; reason: string } & InclusionCase & ConsistencyCase)[])(
    "rejects: $reason",
    (c) => {
      const check = () => (c.kind === "inclusion" ? checkInclusion(c, vkey) : checkConsistency(c, vkey));
      expect(check).toThrow();
    },
  );

  it("rejects verifier keys whose id does not match", () => {
    expect(() => parseVerifierKey(D2.vkey.replace(/\+[0-9a-f]{8}\+/, "+00000000+"))).toThrow(/id/);
  });
});
