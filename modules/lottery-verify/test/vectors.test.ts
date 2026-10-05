import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  chainHash,
  checkMemberInclusion,
  commitmentHash,
  commitmentText,
  drawSeed,
  KNOWN_CHAINS,
  leafData,
  panelAfter,
  parseChainInfo,
  parseCommitment,
  poolRoot,
  Stream,
  trustedChains,
  verifyBeacon,
  verifyTranscript,
  VerifyError,
  type Result,
} from "../src/index.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../spec/lottery/vectors/${name}`, import.meta.url), "utf8"));
const V = load("draws.json");
const B = Object.fromEntries(load("beacons.json").beacons.map((b: { name: string }) => [b.name, b]));
const trustedFor = (info: unknown) => trustedChains(info ? [parseChainInfo(info)] : []);

describe("pool", () => {
  it("encodes leaves and computes the root", () => {
    const { members, root } = poolRoot(V.pool.members);
    expect(members.map((m) => leafData(m).toString("ascii"))).toEqual(V.pool.leaf_data);
    expect(root).toBe(V.pool.root);
    expect(poolRoot([...V.pool.members].reverse()).root).toBe(V.pool.root);
  });

  it("accepts every inclusion proof and rejects tampered ones", () => {
    for (const p of V.pool.inclusion) checkMemberInclusion(V.pool.root, 5, p);
    const p = structuredClone(V.pool.inclusion[1]);
    expect(() => checkMemberInclusion(V.pool.root, 6, p)).toThrow(VerifyError);
    p.member.nym = "nym-other";
    expect(() => checkMemberInclusion(V.pool.root, 5, p)).toThrow(VerifyError);
  });

  it("rejects duplicates, empty pools and bad tokens", () => {
    expect(() => poolRoot([])).toThrow(VerifyError);
    expect(() => poolRoot([{ nym: "a" }, { nym: "a" }])).toThrow(VerifyError);
    expect(() => poolRoot([{ nym: "has space" }])).toThrow(VerifyError);
    expect(() => poolRoot([{ nym: "a", strata: { "a=b": "c" } }])).toThrow(VerifyError);
  });
});

describe("stream", () => {
  it("matches the u64 and below vectors", () => {
    for (const v of V.streams) {
      let s = new Stream(Buffer.from(v.seed, "hex"));
      expect(v.u64.map(() => s.u64().toString())).toEqual(v.u64);
      s = new Stream(Buffer.from(v.seed, "hex"));
      expect(v.below.map((b: { n: string }) => s.below(BigInt(b.n)).toString())).toEqual(
        v.below.map((b: { value: string }) => b.value),
      );
    }
  });
});

describe("drand", () => {
  it("recomputes the published chain hashes", () => {
    expect(chainHash(KNOWN_CHAINS.quicknet!)).toBe("52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971");
    expect(chainHash(KNOWN_CHAINS.default!)).toBe("8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce");
    const w = B["walkthrough-rfc9380-38"];
    expect(chainHash(parseChainInfo(w.chain_info))).toBe(w.chain_hash);
  });

  it("verifies the recorded beacons", () => {
    const d = B["default-mainnet-2634945"].beacon;
    expect(verifyBeacon(KNOWN_CHAINS.default!, d, 2634945).toString("hex")).toBe(d.randomness);
    const w = B["walkthrough-rfc9380-38"];
    expect(verifyBeacon(parseChainInfo(w.chain_info), w.beacon, 38).toString("hex")).toBe(w.beacon.randomness);
  });

  it("rejects a valid signature under the wrong key or round", () => {
    const w = B["walkthrough-rfc9380-38"];
    expect(() => verifyBeacon(KNOWN_CHAINS.quicknet!, w.beacon, 38)).toThrow(/does not verify/);
    expect(() => verifyBeacon(parseChainInfo(w.chain_info), { ...w.beacon, round: 55 }, 55)).toThrow(/does not verify/);
    expect(() => verifyBeacon(parseChainInfo(w.chain_info), w.beacon, 39)).toThrow(/round 38/);
  });
});

describe("draws", () => {
  it("encodes commitments and seeds as the vectors do", () => {
    for (const d of V.draws) {
      const c = parseCommitment(d.transcript.commitment);
      expect(commitmentText(c)).toBe(d.commitment_text);
      expect(commitmentHash(c).toString("hex")).toBe(d.transcript.result.commitment_hash);
      expect(drawSeed(c, Buffer.from(d.transcript.beacon.randomness, "hex")).toString("hex")).toBe(d.seed);
    }
  });

  it("reproduces every published draw", () => {
    for (const d of V.draws) {
      expect(verifyTranscript(d.transcript, trustedFor(d.trusted_chain_info))).toEqual(d.transcript.result);
    }
  });

  it("reproduces a draw from the commitment, pool and beacon alone (no published result)", () => {
    const { result, ...inputs } = V.draws[0].transcript;
    expect(verifyTranscript(inputs)).toEqual(result);
  });

  it.each(V.invalid as { reason: string; transcript: unknown; trusted_chain_info: unknown }[])(
    "rejects: $reason",
    (c) => {
      expect(() => verifyTranscript(c.transcript, trustedFor(c.trusted_chain_info))).toThrow(VerifyError);
    },
  );

  it("fills declined seats from the same stratum's order", () => {
    const r = V.replacements;
    const result: Result = V.draws.find((d: { name: string }) => d.name === r.draw).transcript.result;
    expect(panelAfter(result, r.declined)).toEqual(r.panel);
    expect(panelAfter(result, [...r.declined].reverse())).toEqual(r.panel);
  });
});
