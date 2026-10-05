// record-verify: exit 0 if a Record proof holds, 1 otherwise.
//
//   record-verify inclusion   --vkey <key|file> --checkpoint <file> --entry <file> --proof <file>
//   record-verify consistency --vkey <key|file> --old <file> --new <file> --proof <file>
//   record-verify --json <file|-> --vkey <key|file>
//
// --json takes one case {"kind": "inclusion"|"consistency", ...the same inputs inline},
// or {"cases": [case, ...]}, where every case must hold and there is at least one.
// The key always comes from --vkey: a "vkey" inside the input is never trusted, and if
// present it must be the same key.

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  checkConsistency,
  checkInclusion,
  parseVerifierKey,
  VerifyError,
  type ConsistencyCase,
  type InclusionCase,
  type VerifierKey,
} from "./verify.ts";

const read = (path: string): string => readFileSync(path === "-" ? 0 : path, "utf8");
const readJson = (path: string): unknown => JSON.parse(read(path));
const vkeyFrom = (value: string): VerifierKey => parseVerifierKey((existsSync(value) ? read(value) : value).trim());

type Case = { kind?: unknown; vkey?: unknown } & Partial<InclusionCase> & Partial<ConsistencyCase>;

/** A key named inside the input must be the trusted key; it is never used in its place. */
function sameKey(embedded: unknown, vkey: VerifierKey): void {
  if (embedded === undefined) return;
  if (typeof embedded !== "string" || parseVerifierKey(embedded).encoded !== vkey.encoded) {
    throw new VerifyError("input names a different verifier key than --vkey");
  }
}

function runCase(c: Case, vkey: VerifierKey): string {
  if (typeof c !== "object" || c === null) throw new VerifyError("case must be a JSON object");
  sameKey(c.vkey, vkey);
  if (c.kind === "inclusion") {
    const cp = checkInclusion(c as InclusionCase, vkey);
    return `entry ${String(c.proof?.seq)} is in ${cp.origin} at size ${cp.size}`;
  }
  if (c.kind === "consistency") {
    checkConsistency(c as ConsistencyCase, vkey);
    return "the new checkpoint extends the old one";
  }
  throw new VerifyError('case kind must be "inclusion" or "consistency"');
}

export function run(argv: string[]): { code: number; out: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "string" },
        vkey: { type: "string" },
        checkpoint: { type: "string" },
        entry: { type: "string" },
        proof: { type: "string" },
        old: { type: "string" },
        new: { type: "string" },
      },
    });
    const need = (name: keyof typeof values): string => {
      const v = values[name];
      if (typeof v !== "string") throw new VerifyError(`missing --${name}`);
      return v;
    };
    if (values.json !== undefined) {
      const vkey = vkeyFrom(need("vkey"));
      const keyName = `key ${vkey.name} (id ${vkey.id.toString("hex")})`;
      const input = readJson(values.json) as Case & { cases?: Case[] };
      if (typeof input !== "object" || input === null) throw new VerifyError("input must be a JSON object");
      if ("cases" in input) {
        sameKey(input.vkey, vkey);
        if (!Array.isArray(input.cases) || input.cases.length === 0) {
          throw new VerifyError("cases must be a non-empty list");
        }
        input.cases.forEach((c, i) => {
          try {
            runCase(c, vkey);
          } catch (err) {
            throw new VerifyError(`case ${i}: ${(err as Error).message}`);
          }
        });
        return { code: 0, out: `ok: all ${input.cases.length} cases hold under ${keyName}` };
      }
      return { code: 0, out: `ok: ${runCase(input, vkey)} under ${keyName}` };
    }
    const kind = positionals[0];
    const vkey = vkeyFrom(need("vkey"));
    if (kind === "inclusion") {
      const c = { kind, checkpoint: read(need("checkpoint")), entry: readJson(need("entry")) };
      return { code: 0, out: `ok: ${runCase({ ...c, proof: readJson(need("proof")) as InclusionCase["proof"] }, vkey)}` };
    }
    if (kind === "consistency") {
      const c = { kind, old: read(need("old")), new: read(need("new")) };
      return { code: 0, out: `ok: ${runCase({ ...c, proof: readJson(need("proof")) as ConsistencyCase["proof"] }, vkey)}` };
    }
    throw new VerifyError("usage: record-verify inclusion|consistency ... or record-verify --json <file> --vkey <key>");
  } catch (err) {
    return { code: 1, out: `fail: ${(err as Error).message}` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(out + "\n");
  process.exitCode = code;
}
