/** Turn a Docket item into numbered sources, and check that quoted evidence really is in them. */

import type { CitedSentence, DocketItem, Lang, Source } from "./types.ts";

/** Source 1 is always the item's own page, built only from fields Docket parsed from it. */
export function dossierFacts(item: DocketItem): string {
  const votes = item.votes
    ? Object.entries(item.votes.counts)
        .map(([vote, n]) => `${vote} ${n}`)
        .join(", ")
    : "";
  const lines = [
    item.number && `Number: ${item.number}`,
    `Title: ${item.title.fr ?? Object.values(item.title)[0] ?? ""}`,
    item.type_label && `Type: ${item.type_label}`,
    item.status && `Status: ${item.status}`,
    item.reference && `Reference: ${item.reference}`,
    item.theme && `Theme: ${item.theme}`,
    item.summary && `Summary: ${item.summary}`,
    item.opens && `Opens: ${item.opens}`,
    item.closes && `Closes: ${item.closes}`,
    item.when && `When: ${item.when}`,
    ...(item.phases ?? []).map((p) => `Phase: ${p.title}${p.start ? ` from ${p.start}` : ""}${p.end ? ` to ${p.end}` : ""}`),
    votes && `Council vote: ${votes}`,
    item.author && `Author: ${item.author}`,
    item.committee && `Committee: ${item.committee}`,
    item.deposited && `Deposited: ${item.deposited}`,
    item.updated && `Last updated: ${item.updated}`,
    ...item.activities.map(
      (a) => `History ${a.date ?? "(no date)"}: ${a.description}${a.actors.length ? ` (${a.actors.join(", ")})` : ""}`,
    ),
    ...item.agenda.map(
      (m) => `On the agenda ${m.date ?? ""} ${m.time ?? ""}: ${m.body}${m.steps.length ? `: ${m.steps.join("; ")}` : ""}`,
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

/** What source 1 is called: whose page it is. */
export function itemLabel(item: DocketItem): string {
  if (item.jurisdiction_id === "lu-esch") {
    return item.type === "agenda"
      ? `Esch-sur-Alzette municipal council, agenda point ${item.number ?? ""}`.trim()
      : `Esch-sur-Alzette participation, ${item.type_label ?? "consultation"}`;
  }
  return `Chamber of Deputies, dossier ${item.number ?? ""}`.trim();
}

/**
 * Numbered sources for one item, within a character budget so prompts stay cheap.
 * Order: dossier facts, bill as filed, then opinions, reports and amendments by date.
 */
export function buildSources(item: DocketItem, lang: Lang, budget = 60_000): Source[] {
  const sources: Source[] = [
    {
      n: 1,
      label: itemLabel(item),
      url: item.urls[lang] ?? item.urls.fr ?? "",
      date: item.updated,
      text: dossierFacts(item),
    },
  ];
  const rank = (kind: string) => ["depot", "avis", "rapport", "amendement"].indexOf(kind);
  const docs = item.documents
    .filter((d) => d.text && !d.error)
    .sort((a, b) => rank(a.kind) - rank(b.kind) || (a.date ?? "").localeCompare(b.date ?? ""));
  let left = budget - sources[0].text.length;
  for (const doc of docs) {
    if (left <= 2_000) break;
    const share = doc.kind === "depot" ? Math.min(left, 30_000) : Math.min(left, 12_000);
    const text = doc.text.slice(0, share);
    sources.push({ n: sources.length + 1, label: doc.label, url: doc.url, date: doc.date, text });
    left -= text.length;
  }
  return sources;
}

export function renderSources(sources: Source[]): string {
  return sources
    .map((s) => `<source n="${s.n}" label="${escapeAttr(s.label)}"${s.date ? ` date="${s.date}"` : ""}>\n${fence(s.text)}\n</source>`)
    .join("\n\n");
}

/** Source text can't close its own wrapper: a document saying "</source>" stays inside it. */
export function fence(text: string): string {
  return text.replace(/<(\/?\s*(?:sources?|claim|conversation|arguments)\b)/gi, "‹$1");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Normalise text for display comparisons: quote styles, PDF hyphenation, spacing and case. */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‛′`]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s*-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Shortest quote that counts as evidence. Short phrases ("le projet de loi") match any bill. */
export const MIN_QUOTE_WORDS = 5;
export const MIN_QUOTE_CHARS = 20;

const ALNUM = /[\p{L}\p{N}]/u;

/**
 * Letters and digits only, lower-cased, plus where each word starts. Comparing on letters alone
 * survives PDF hyphenation ("opération -\nnalisation"), stray spaces and punctuation, while the
 * word starts keep a match from beginning or ending in the middle of a word.
 */
function compact(text: string): { chars: string; starts: boolean[] } {
  let chars = "";
  const starts: boolean[] = [];
  let inWord = false;
  for (const ch of text.normalize("NFKC").toLowerCase()) {
    if (ALNUM.test(ch)) {
      chars += ch;
      starts.push(!inWord);
      inWord = true;
    } else {
      inWord = false;
    }
  }
  starts.push(true);
  return { chars, starts };
}

const compactCache = new Map<string, ReturnType<typeof compact>>();
function compactSource(text: string) {
  let hit = compactCache.get(text);
  if (!hit) {
    if (compactCache.size > 200) compactCache.clear();
    hit = compact(text);
    compactCache.set(text, hit);
  }
  return hit;
}

/**
 * True when `quote` appears word for word in one of the cited sources. Punctuation, spacing,
 * case and line-break hyphens are ignored; the match must start and end on word boundaries and
 * the quote must be at least MIN_QUOTE_WORDS words long. "Found" means the words are there, not
 * that they support the sentence they are attached to.
 */
export function quoteIsIn(quote: string | undefined, cited: number[], sources: Source[]): boolean {
  if (!quote) return false;
  const words = quote.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < MIN_QUOTE_WORDS) return false;
  const q = compact(quote).chars;
  if (q.length < MIN_QUOTE_CHARS) return false;
  return cited.some((n) => {
    const s = sources.find((x) => x.n === n);
    if (!s) return false;
    const { chars, starts } = compactSource(s.text);
    for (let i = chars.indexOf(q); i >= 0; i = chars.indexOf(q, i + 1)) {
      if (starts[i] && starts[i + q.length]) return true;
    }
    return false;
  });
}

/** Keep only citations that point at real sources, and mark whether the quote checks out. */
export function verifySentence(
  raw: { text?: unknown; sources?: unknown; quote?: unknown },
  sources: Source[],
): CitedSentence | null {
  if (typeof raw.text !== "string" || !raw.text.trim()) return null;
  const known = new Set(sources.map((s) => s.n));
  const cited = Array.isArray(raw.sources)
    ? [...new Set(raw.sources.map(Number).filter((n) => known.has(n)))]
    : [];
  const quote = typeof raw.quote === "string" ? raw.quote : undefined;
  return { text: raw.text.trim(), sources: cited, quote, verified: cited.length > 0 && quoteIsIn(quote, cited, sources) };
}

/** The model's answer held no JSON object the Companion could read. The server turns it into a 502. */
export class ModelAnswerError extends Error {}

/** Every `{...}` in the text whose braces balance outside of strings, earliest start first. */
function* objectCandidates(text: string): Generator<string> {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "{") starts.push(i);
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        yield text.slice(start, i + 1);
        break;
      }
    }
  }
}

/**
 * Reads the JSON object out of a model answer. Models wrap JSON in prose, in ``` fences or in
 * <think> blocks, so this takes the fenced block when there is one and otherwise the first
 * balanced `{...}` that parses to an object. Anything else (a refusal, a list, plain text) is a
 * ModelAnswerError, never a crash further down.
 */
export function parseJson<T>(answer: string): T {
  const text = String(answer ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  for (const body of [...fenced, text]) {
    // A whole answer that is JSON but not an object (a list, a bare value) is refused, not mined.
    try {
      const whole: unknown = JSON.parse(body.trim());
      if (whole && typeof whole === "object" && !Array.isArray(whole)) return whole as T;
      throw new ModelAnswerError("the model returned JSON that is not an object");
    } catch (e) {
      if (e instanceof ModelAnswerError) throw e;
    }
    for (const candidate of objectCandidates(body)) {
      try {
        const value: unknown = JSON.parse(candidate);
        if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
      } catch {
        // not this one; try the next balanced object
      }
    }
  }
  throw new ModelAnswerError("the model did not return JSON");
}
