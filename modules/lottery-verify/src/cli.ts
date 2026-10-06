// lottery-verify: exit 0 if a published Lottery draw reproduces, 1 otherwise.
//
//   lottery-verify --transcript <file|->                 reproduce the draw in a transcript
//   lottery-verify --transcript <file> --fetch           the transcript has no beacon: fetch the
//                                                        committed round from a drand relay
//   lottery-verify ... --chain-info <file>               also trust this drand chain (e.g. a test chain)
//   lottery-verify ... --declined <nym> [--declined ..]  print the panel after these declines
//   lottery-verify member --root <hex> --size <n> --proof <file>   check a pool inclusion proof
//
// Only the League of Entropy mainnet chains are trusted by default. Every success ends with a
// warning line: the commit time is not yet checked against Record (spec section 7, step 0).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { fetchBeacon, parseChainInfo, type Fetch } from "./drand.ts";
import {
  checkMemberInclusion,
  panelAfter,
  parseCommitment,
  parseJson,
  trustedChains,
  UNANCHORED_WARNING,
  verifyTranscript,
  VerifyError,
} from "./verify.ts";

const read = (path: string): string => readFileSync(path === "-" ? 0 : path, "utf8");
const readJson = (path: string): unknown => parseJson(read(path));

const httpGet: Fetch = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new VerifyError(`${url}: HTTP ${res.status}`);
  return res.text();
};

export async function run(argv: string[], get: Fetch = httpGet): Promise<{ code: number; out: string }> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        transcript: { type: "string" },
        "chain-info": { type: "string" },
        fetch: { type: "boolean" },
        "drand-url": { type: "string", default: "https://api.drand.sh" },
        declined: { type: "string", multiple: true },
        root: { type: "string" },
        size: { type: "string" },
        proof: { type: "string" },
      },
    });
    if (positionals[0] === "member") {
      const { root, size, proof } = values;
      if (!root || !size || !proof) throw new VerifyError("usage: lottery-verify member --root <hex> --size <n> --proof <file>");
      if (!/^(0|[1-9][0-9]*)$/.test(size)) throw new VerifyError("--size must be a decimal integer");
      checkMemberInclusion(root, Number(size), readJson(proof));
      return { code: 0, out: "ok: the member is in the pool" };
    }
    if (positionals.length > 0 || !values.transcript) throw new VerifyError("usage: lottery-verify --transcript <file>");
    const extra = values["chain-info"] ? [parseChainInfo(readJson(values["chain-info"]))] : [];
    const trusted = trustedChains(extra);
    const t = readJson(values.transcript) as Record<string, unknown>;
    if (typeof t !== "object" || t === null) throw new VerifyError("the transcript is an object");
    if (values.fetch) {
      if (t.beacon !== undefined) throw new VerifyError("--fetch is for a transcript without a beacon");
      const c = parseCommitment(t.commitment);
      const chain = trusted.get(c.chain);
      if (!chain) throw new VerifyError(`chain ${c.chain} is not a trusted drand chain`);
      t.beacon = await fetchBeacon(chain, c.round, values["drand-url"]!, get);
    }
    const result = verifyTranscript(t, trusted);
    const lines = [`ok: the draw reproduces; ${result.selected.length} selected`, ...result.selected];
    if (values.declined) {
      const p = panelAfter(result, values.declined);
      lines.push(`panel after ${values.declined.length} declined (${p.short} short):`, ...p.members);
    }
    lines.push(UNANCHORED_WARNING);
    return { code: 0, out: lines.join("\n") };
  } catch (err) {
    return { code: 1, out: `fail: ${(err as Error).message}` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, out } = await run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(out + "\n");
  process.exitCode = code;
}
