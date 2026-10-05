import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const D2 = JSON.parse(readFileSync(new URL("../../../spec/record/vectors/d2-log.json", import.meta.url), "utf8"));

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", CLI, ...args], {
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function files(obj: Record<string, unknown>): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "record-verify-"));
  return Object.fromEntries(
    Object.entries(obj).map(([name, value]) => {
      const path = join(dir, name);
      writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
      return [name, path];
    }),
  );
}

describe("record-verify CLI", () => {
  const proof = D2.inclusion.find((p: { seq: number; size: number }) => p.seq === 4 && p.size === 11);

  it("exits 0 for a good inclusion proof given as files", () => {
    const f = files({ vkey: D2.vkey, cp: D2.checkpoints["11"], entry: D2.entries[4], proof });
    const r = cli("inclusion", "--vkey", f.vkey, "--checkpoint", f.cp, "--entry", f.entry, "--proof", f.proof);
    expect(r.out).toContain("ok: entry 4 is in");
    expect(r.code).toBe(0);
  });

  it("exits 1 when the entry does not match", () => {
    const f = files({ cp: D2.checkpoints["11"], entry: D2.entries[5], proof });
    const r = cli("inclusion", "--vkey", D2.vkey, "--checkpoint", f.cp, "--entry", f.entry, "--proof", f.proof);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^fail: /);
  });

  it("checks consistency from files", () => {
    const p = D2.consistency.find((c: { from: number; to: number }) => c.from === 5 && c.to === 13);
    const f = files({ old: D2.checkpoints["5"], new: D2.checkpoints["13"], proof: p });
    expect(cli("consistency", "--vkey", D2.vkey, "--old", f.old, "--new", f.new, "--proof", f.proof).code).toBe(0);
    expect(cli("consistency", "--vkey", D2.vkey, "--old", f.new, "--new", f.old, "--proof", f.proof).code).toBe(1);
  });

  it("takes one case or a batch as JSON", () => {
    const one = { kind: "inclusion", vkey: D2.vkey, checkpoint: D2.checkpoints["11"], entry: D2.entries[4], proof };
    const batch = { vkey: D2.vkey, cases: D2.invalid.slice(0, 1) };
    const f = files({ one, batch, good: { vkey: D2.vkey, cases: [one, one] } });
    expect(cli("--json", f.one).code).toBe(0);
    expect(cli("--json", f.good).out).toContain("ok: all 2 cases hold");
    const bad = cli("--json", f.batch);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("case 0:");
  });

  it("exits 1 on usage errors", () => {
    expect(cli().code).toBe(1);
    expect(cli("inclusion", "--vkey", D2.vkey).code).toBe(1);
  });
});
