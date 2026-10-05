/** Turn a Docket item into numbered sources, and check that quoted evidence really is in them. */

import type { CitedSentence, DocketItem, Lang, Source } from "./types.ts";

/** Source 1 is always the dossier page itself, built only from fields Docket parsed from it. */
export function dossierFacts(item: DocketItem): string {
  const lines = [
    `Number: ${item.number}`,
    `Title: ${item.title.fr ?? Object.values(item.title)[0] ?? ""}`,
    item.type_label && `Type: ${item.type_label}`,
    item.status && `Status: ${item.status}`,
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

/**
 * Numbered sources for one item, within a character budget so prompts stay cheap.
 * Order: dossier facts, bill as filed, then opinions, reports and amendments by date.
 */
export function buildSources(item: DocketItem, lang: Lang, budget = 60_000): Source[] {
  const sources: Source[] = [
    {
      n: 1,
      label: `Chamber of Deputies, dossier ${item.number}`,
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
    .map((s) => `<source n="${s.n}" label="${escapeAttr(s.label)}"${s.date ? ` date="${s.date}"` : ""}>\n${s.text}\n</source>`)
    .join("\n\n");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Normalise text so a quote survives PDF line breaks, hyphenation, quote styles and case. */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‛′`]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `quote` appears word for word (after normalising) in any of the cited sources. */
export function quoteIsIn(quote: string | undefined, cited: number[], sources: Source[]): boolean {
  if (!quote) return false;
  const q = normalise(quote);
  if (q.length < 8) return false;
  return cited.some((n) => {
    const s = sources.find((x) => x.n === n);
    return s ? normalise(s.text).includes(q) : false;
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

/** Parse the first JSON object in a model answer (models sometimes wrap it in prose or fences). */
export function parseJson<T>(answer: string): T {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : answer;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the model did not return JSON");
  return JSON.parse(body.slice(start, end + 1)) as T;
}
