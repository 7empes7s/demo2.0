/**
 * Translations of the public list's French text (titles, summaries, status, agenda steps,
 * history lines, document names, committee and theme names) into the app's other languages.
 *
 * Done once on the server, in the background, through the same model as the Companion, and
 * served to every device alike at `/data/translations.json`. So a device never asks for its own
 * language or for the files it reads: the network sees the same requests whatever the resident
 * chose. Translations are keyed by the French text itself, so a text the list keeps from one
 * refresh to the next is translated once, and they are kept in a cache file across restarts.
 *
 * The app shows the original French with one tap, and the documents themselves are never
 * translated: quotes stay in the original.
 */

import { readFile, rename, writeFile } from "node:fs/promises";

import type { Provider } from "./provider.ts";
import { JSON_ONLY } from "./prompts.ts";
import { parseJson } from "./sources.ts";
import type { DocketItem, DocketSnapshot, Lang } from "./types.ts";

/** The languages the French text is translated into. */
export const TARGETS = ["en", "de", "lb", "pt"] as const satisfies readonly Lang[];
export type Target = (typeof TARGETS)[number];
export type Translation = Record<Target, string>;

export const TRANSLATIONS_SCHEMA = "d2.translations/1";

/** Text the Chamber's page leaves in history rows (screen-reader button labels); the app strips it too. */
const PAGE_NOISE = /\s*Bouton graphique servant à afficher ou cacher tous les éléments de la liste qui précède\s*(Voir plus)?\s*(Voir moins)?/gi;
const FILE_NAME = /\.[a-z0-9]{2,4}$/i;
const clean = (s: string) => s.replace(PAGE_NOISE, " ").replace(/\s+/g, " ").trim();

/** Every French text a file shows, once each. Names of people, numbers and dates are not text. */
export function textsOfItem(item: DocketItem): string[] {
  const out: (string | null | undefined)[] = [
    item.title?.fr ?? Object.values(item.title ?? {})[0],
    item.summary,
    item.status && !item.status.startsWith("CHD_") ? item.status : null,
    item.type_label,
    item.committee,
    item.theme,
    item.when,
  ];
  for (const m of item.agenda ?? []) out.push(m.body, ...(m.steps ?? []));
  for (const a of item.activities ?? []) out.push(a.description);
  // A document named by its file name ("30 PAP Quai Neiduerf_PE_approuvé.pdf") keeps that name.
  for (const d of item.documents ?? []) if (!FILE_NAME.test(d.label ?? "")) out.push(d.label);
  for (const p of item.phases ?? []) out.push(p.title);
  return out.filter((s): s is string => typeof s === "string").map(clean).filter((s) => s.length > 0);
}

/** Every French text in the snapshot, once each, in a stable order. */
export function textsOf(snapshot: DocketSnapshot): string[] {
  return [...new Set(snapshot.items.flatMap(textsOfItem))];
}

export function translateSystem(): string {
  return `You translate short texts from Luxembourg's public bodies (the Chamber of Deputies and the city of Esch-sur-Alzette) from French into English (en), German (de), Luxembourgish (lb) and Portuguese as spoken in Portugal (pt).

Rules:
- Translate faithfully and plainly. Add nothing, explain nothing, leave nothing out.
- Keep numbers, dates, article and law references, people's names, party names, place names and abbreviations exactly as written.
- Keep the register of an official title: a bill title stays a bill title.
- Every input gets every language, even a single word.

${JSON_ONLY} {"items": [{"i": 0, "en": "...", "de": "...", "lb": "...", "pt": "..."}]}`;
}

/** Groups texts into requests of about `chars` characters of French each. */
export function batches(texts: readonly string[], chars: number): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length && size + text.length > chars) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) out.push(current);
  return out;
}

/** A translation is kept only if every language is there and none is absurdly long or empty. */
function valid(source: string, value: unknown): value is Translation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return TARGETS.every((l) => typeof v[l] === "string" && (v[l] as string).trim().length > 0 && (v[l] as string).length <= source.length * 4 + 40);
}

/** Asks the model for one batch. Returns the translations it could read; the rest are retried on a later run. */
export async function translateBatch(provider: Provider, texts: readonly string[]): Promise<Map<string, Translation>> {
  const input = JSON.stringify({ items: texts.map((text, i) => ({ i, fr: text })) });
  const chars = texts.reduce((n, t) => n + t.length, 0);
  const answer = await provider.complete({
    system: translateSystem(),
    messages: [{ role: "user", content: input }],
    // Four languages out for one in, plus the JSON around them.
    maxTokens: Math.min(8_000, 400 + Math.ceil(chars * 1.6)),
  });
  const parsed = parseJson<{ items?: unknown }>(answer);
  const out = new Map<string, Translation>();
  for (const row of Array.isArray(parsed.items) ? parsed.items : []) {
    const r = row as Record<string, unknown>;
    const i = typeof r.i === "number" ? r.i : Number.NaN;
    const source = texts[i];
    if (source === undefined || !valid(source, r)) continue;
    out.set(source, Object.fromEntries(TARGETS.map((l) => [l, (r[l] as string).trim()])) as Translation);
  }
  return out;
}

export interface TranslatorOptions {
  provider: Provider | null;
  /** Where translations are kept across restarts; null keeps them in memory only. */
  cachePath?: string | null;
  /** French characters per request (default 2,500). */
  batchChars?: number;
  /** Pause between requests, to stay inside a free tier's rate limit (default 3 s). */
  intervalMs?: number;
  log?: (line: string) => void;
}

/**
 * Holds the translations of the current snapshot's texts and fills in the missing ones in the
 * background. `body()` is what `/data/translations.json` serves: complete entries only, for the
 * texts in the snapshot now, the same bytes for every device until a new batch lands.
 */
export class Translator {
  private readonly known = new Map<string, Translation>();
  private readonly texts: string[];
  private served: { body: Buffer; tag: string } | null = null;
  private readonly opts: Required<Omit<TranslatorOptions, "provider" | "cachePath">> & Pick<TranslatorOptions, "provider" | "cachePath">;

  constructor(snapshot: DocketSnapshot, opts: TranslatorOptions) {
    this.texts = textsOf(snapshot);
    this.opts = { batchChars: 2_500, intervalMs: 3_000, log: (l) => console.log(l), cachePath: null, ...opts };
  }

  /** Reads the cache file, if there is one. A missing or broken file starts empty. */
  async load(): Promise<void> {
    if (!this.opts.cachePath) return;
    try {
      const raw = JSON.parse(await readFile(this.opts.cachePath, "utf8")) as { texts?: Record<string, unknown> };
      for (const [source, value] of Object.entries(raw.texts ?? {})) if (valid(source, value)) this.known.set(source, value);
    } catch {
      // first start, or a cache that cannot be read: translate again
    }
    this.served = null;
  }

  /** Texts in the snapshot with no translation yet. */
  missing(): string[] {
    return this.texts.filter((t) => !this.known.has(t));
  }

  /** Adds translations (tests, and each batch as it lands). */
  add(found: Map<string, Translation>) {
    for (const [k, v] of found) this.known.set(k, v);
    if (found.size) this.served = null;
  }

  body(): { body: Buffer; tag: string } {
    if (!this.served) {
      const texts: Record<string, Translation> = {};
      for (const t of this.texts) {
        const v = this.known.get(t);
        if (v) texts[t] = v;
      }
      const body = Buffer.from(JSON.stringify({ schema: TRANSLATIONS_SCHEMA, from: "fr", texts }));
      // A cheap tag is enough: the body only grows while the process runs.
      this.served = { body, tag: `"t${Object.keys(texts).length}-${body.length}"` };
    }
    return this.served;
  }

  /**
   * Translates what is missing, one batch at a time, saving after each. Stops at the end, on
   * `signal`, or after three failed batches in a row (the model is down or out of quota; the
   * next start tries again). Never throws.
   */
  async run(signal?: AbortSignal): Promise<void> {
    const provider = this.opts.provider;
    if (!provider) return;
    const todo = batches(this.missing(), this.opts.batchChars);
    if (!todo.length) return;
    this.opts.log(`translations: ${this.missing().length} texts to translate in ${todo.length} requests`);
    let failures = 0;
    for (const [n, batch] of todo.entries()) {
      if (signal?.aborted) return;
      try {
        const found = await translateBatch(provider, batch);
        this.add(found);
        failures = 0;
        await this.save();
      } catch (e) {
        failures += 1;
        this.opts.log(`translations: request ${n + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
        if (failures >= 3) {
          this.opts.log("translations: stopping after three failed requests; the next start tries again");
          return;
        }
      }
      if (n < todo.length - 1) await sleep(this.opts.intervalMs, signal);
    }
    this.opts.log(`translations: done, ${this.missing().length} texts left untranslated`);
  }

  /** Keeps every translation ever made (a text can come back in a later refresh), written atomically. */
  private async save() {
    if (!this.opts.cachePath) return;
    try {
      const tmp = `${this.opts.cachePath}.tmp`;
      await writeFile(tmp, JSON.stringify({ schema: TRANSLATIONS_SCHEMA, from: "fr", texts: Object.fromEntries(this.known) }));
      await rename(tmp, this.opts.cachePath);
    } catch (e) {
      this.opts.log(`translations: cannot save the cache (${e instanceof Error ? e.message : String(e)}); keeping them in memory`);
      this.opts.cachePath = null;
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (ms <= 0 || signal?.aborted) return done();
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      done();
    });
  });
}
