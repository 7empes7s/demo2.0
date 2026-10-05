import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { run } from "../src/cli.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../spec/lottery/vectors/${name}`, import.meta.url), "utf8"));
const V = load("draws.json");
const B = Object.fromEntries(load("beacons.json").beacons.map((b: { name: string }) => [b.name, b]));

function file(obj: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "lottery-verify-")), "f.json");
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

describe("lottery-verify CLI", () => {
  const plain = V.draws[0].transcript;

  it("exits 0 for a published draw and lists the panel", async () => {
    const r = await run(["--transcript", file(plain)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ok: the draw reproduces; 5 selected");
    for (const nym of plain.result.selected) expect(r.out).toContain(nym);
  });

  it("exits 1 for an edited result", async () => {
    const bad = structuredClone(plain);
    bad.result.selected.reverse();
    const r = await run(["--transcript", file(bad)]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("differs from the recomputed draw");
  });

  it("fetches the committed round through an injected relay when the beacon is missing", async () => {
    const { beacon, ...rest } = plain;
    const urls: string[] = [];
    const relay = async (url: string) => {
      urls.push(url);
      return JSON.stringify(beacon);
    };
    const r = await run(["--transcript", file(rest), "--fetch", "--drand-url", "https://relay.example/"], relay);
    expect(r.code).toBe(0);
    expect(urls).toEqual([`https://relay.example/${plain.commitment.chain}/public/${plain.commitment.round}`]);
  });

  it("rejects a forged beacon served by a relay", async () => {
    const { beacon, ...rest } = plain;
    const forged = { ...beacon, signature: beacon.signature.replace(/^(.{20})./, (_: string, p: string) => p + (beacon.signature[20] === "0" ? "1" : "0")) };
    const r = await run(["--transcript", file(rest), "--fetch"], async () => JSON.stringify(forged));
    expect(r.code).toBe(1);
  });

  it("needs explicit trust for a non-mainnet chain", async () => {
    const d = V.draws.find((x: { name: string }) => x.name === "stratified-walkthrough");
    expect((await run(["--transcript", file(d.transcript)])).code).toBe(1);
    const info = file(B["walkthrough-rfc9380-38"].chain_info);
    const r = await run(["--transcript", file(d.transcript), "--chain-info", info, "--declined", V.replacements.declined[0]]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("panel after 1 declined (0 short)");
  });

  it("checks a member's inclusion proof", async () => {
    const proof = file(V.pool.inclusion[3]);
    expect((await run(["member", "--root", V.pool.root, "--size", "5", "--proof", proof])).code).toBe(0);
    expect((await run(["member", "--root", V.pool.root, "--size", "4", "--proof", proof])).code).toBe(1);
  });
});
