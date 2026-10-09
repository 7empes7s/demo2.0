/**
 * Anyone's check of the Desk log's daily fingerprints, from outside the server:
 *
 *   node --experimental-strip-types modules/desk/src/check-log.ts \
 *     --url https://cracia.techinsiderbytes.com/api/desk --vkey <the log's key> [--keep saved.json] [--out dir]
 *
 * 1. Every day's checkpoint is signed by the pinned key and names the log.
 * 2. Each day's log contains the day before's unchanged (a consistency proof from the server,
 *    checked here; the server cannot forge one for a rewritten log).
 * 3. With --keep: every checkpoint saved by an earlier run is still published, word for word,
 *    and the file is then refreshed. Someone who keeps a copy catches a rewrite of the whole list.
 * 4. With --out: each day's note and its timestamp receipt as <day>.txt and <day>.ots, for
 *    `ots verify` (OpenTimestamps) and for `record-verify consistency` (modules/record-verify).
 *
 * Exits 0 when everything holds, 1 otherwise. Needs Node 22 and nothing else.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { type Checkpoint, openCheckpoint, parseVerifier, verifyConsistency } from "./fingerprint.ts";

export interface PublishedDay {
  day: string;
  size: number;
  note: string;
  ots: string | null;
}

export interface Published {
  enabled: boolean;
  key?: string;
  days: PublishedDay[];
}

export type ProofSource = (from: number, to: number) => Promise<string[]>;

/** The checks, without the network: returns the lines to print and whether all hold. */
export async function checkPublished(pub: Published, vkey: string, proof: ProofSource, saved?: Published): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const fail = (msg: string) => {
    lines.push(`fail: ${msg}`);
    return { ok: false, lines };
  };
  if (!pub.enabled) return fail("this server does not publish a daily fingerprint");
  const v = parseVerifier(vkey);
  if (pub.key && pub.key !== vkey.trim()) lines.push(`note: the server names the key ${pub.key}; checking with the one you gave`);
  if (!pub.days.length) return fail("no fingerprint published yet");

  const cps: (Checkpoint & { day: string })[] = [];
  for (const d of pub.days) {
    let cp: Checkpoint;
    try {
      cp = openCheckpoint(d.note, v);
    } catch (e) {
      return fail(`${d.day}: ${e instanceof Error ? e.message : e}`);
    }
    if (cp.size !== d.size) return fail(`${d.day}: the listed size is not the signed one`);
    if (new Date(cp.timestamp * 1000).toISOString().slice(0, 10) !== d.day) return fail(`${d.day}: signed on another day`);
    const prev = cps.at(-1);
    if (prev && prev.day >= d.day) return fail(`${d.day}: days are out of order`);
    cps.push({ ...cp, day: d.day });
  }
  lines.push(`ok: ${cps.length} checkpoint(s) signed by ${v.name}, ${cps[0].day} to ${cps.at(-1)!.day}`);

  for (let i = 1; i < cps.length; i++) {
    const a = cps[i - 1];
    const b = cps[i];
    if (b.size < a.size) return fail(`${b.day}: the log shrank from ${a.size} to ${b.size} entries`);
    if (a.size === 0) continue;
    const held = a.size === b.size ? a.root.equals(b.root) : verifyConsistency(a.size, b.size, a.root, b.root, (await proof(a.size, b.size)).map((h) => Buffer.from(h, "base64")));
    if (!held) return fail(`${b.day}: the log of ${a.day} is not contained unchanged in it`);
  }
  lines.push(`ok: each day's log contains the day before's unchanged (latest: ${cps.at(-1)!.size} entries)`);

  if (saved) {
    const now = new Map(pub.days.map((d) => [d.day, d.note]));
    for (const d of saved.days) {
      if (now.get(d.day) !== d.note) return fail(`${d.day}: the checkpoint you saved earlier is no longer published as it was`);
    }
    lines.push(`ok: all ${saved.days.length} checkpoint(s) you saved earlier are still published unchanged`);
  }
  const stamped = pub.days.filter((d) => d.ots).length;
  lines.push(`info: ${stamped} of ${pub.days.length} day(s) have a Bitcoin timestamp receipt (check them with --out and \`ots verify\`)`);
  return { ok: true, lines };
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: "string" }, vkey: { type: "string" }, keep: { type: "string" }, out: { type: "string" } } });
  if (!values.url || !values.vkey) {
    console.error("usage: check-log.ts --url <desk api> --vkey <key or file> [--keep saved.json] [--out dir]");
    process.exit(2);
  }
  const base = values.url.replace(/\/+$/, "");
  const vkey = existsSync(values.vkey) ? readFileSync(values.vkey, "utf8").trim() : values.vkey;
  const get = async (path: string) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
  const pub = (await get("/fingerprints")) as Published;
  const saved = values.keep && existsSync(values.keep) ? (JSON.parse(readFileSync(values.keep, "utf8")) as Published) : undefined;
  const result = await checkPublished(pub, vkey, async (from, to) => ((await get(`/fingerprints/consistency?from=${from}&to=${to}`)) as { proof: string[] }).proof, saved);
  for (const l of result.lines) console.log(l);
  if (!result.ok) process.exit(1);
  if (values.keep) writeFileSync(values.keep, JSON.stringify({ enabled: true, key: vkey, days: pub.days.map(({ day, size, note, ots }) => ({ day, size, note, ots })) }, null, 1));
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    for (const d of pub.days) {
      writeFileSync(join(values.out, `${d.day}.txt`), d.note);
      if (d.ots) writeFileSync(join(values.out, `${d.day}.ots`), Buffer.from(d.ots, "base64"));
    }
    console.log(`wrote ${pub.days.length} note(s) to ${values.out}`);
  }
}

// pathToFileURL: a checkout under a path with spaces must still run the check, never exit 0 silently.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`fail: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
