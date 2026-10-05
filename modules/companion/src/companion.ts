/** The Companion's four abilities. Each builds a prompt, calls the provider and checks the answer. */

import { argumentsSystem, challengeSystem, claimSystem, explainSystem, PROMPT_VERSION } from "./prompts.ts";
import type { Provider } from "./provider.ts";
import { buildSources, parseJson, quoteIsIn, renderSources, verifySentence } from "./sources.ts";
import type {
  ChatMessage,
  CitedSentence,
  Depth,
  DocketItem,
  GradeValue,
  Lang,
  Position,
  Source,
} from "./types.ts";

/** What every answer records about how it was made. */
export interface Provenance {
  prompt_version: string;
  model: string;
  item_id: string;
  created_at: string;
}

function provenance(provider: Provider, item: DocketItem): Provenance {
  return { prompt_version: PROMPT_VERSION, model: provider.model, item_id: item.id, created_at: new Date().toISOString() };
}

function sourceMessage(sources: Source[], ask: string): ChatMessage {
  return { role: "user", content: `<sources>\n${renderSources(sources)}\n</sources>\n\n${ask}` };
}

// ---------------------------------------------------------------- explain

export interface Explanation {
  headline: string;
  sections: { heading: string; sentences: CitedSentence[] }[];
  sources: Source[];
  /** Share of fact-bearing sentences whose quote was found in the cited source. */
  verified_share: number;
  provenance: Provenance;
}

export async function explain(
  provider: Provider,
  item: DocketItem,
  opts: { lang: Lang; depth: Depth; onText?: (t: string) => void; signal?: AbortSignal },
): Promise<Explanation> {
  const sources = buildSources(item, opts.lang);
  const answer = await provider.complete({
    system: explainSystem(opts.lang, opts.depth),
    messages: [sourceMessage(sources, "Explain this file.")],
    maxTokens: opts.depth === "deep" ? 4000 : 2500,
    onText: opts.onText,
    signal: opts.signal,
  });
  const raw = parseJson<{ headline?: string; sections?: { heading?: string; sentences?: unknown[] }[] }>(answer);
  const sections = (raw.sections ?? [])
    .map((s) => ({
      heading: String(s.heading ?? ""),
      sentences: (s.sentences ?? [])
        .map((x) => verifySentence((x ?? {}) as Record<string, unknown>, sources))
        .filter((x): x is CitedSentence => x !== null),
    }))
    .filter((s) => s.sentences.length > 0);
  const cited = sections.flatMap((s) => s.sentences).filter((s) => s.sources.length > 0);
  const verified = cited.filter((s) => s.verified).length;
  return {
    headline: String(raw.headline ?? ""),
    sections,
    sources,
    verified_share: cited.length ? verified / cited.length : 0,
    provenance: provenance(provider, item),
  };
}

// ---------------------------------------------------------------- arguments (Commons seed)

export interface Argument {
  id: string;
  stance: "supports" | "opposes" | "asks_changes";
  by: string;
  summary_en: string;
  source: number;
  quote: string;
}

/**
 * Arguments made by named institutions in the file's own documents. Only arguments whose quote
 * is found word for word in the cited source are kept, so the devil's advocate can't drift
 * into invented positions.
 */
export async function extractArguments(
  provider: Provider,
  item: DocketItem,
  opts: { signal?: AbortSignal } = {},
): Promise<{ arguments: Argument[]; sources: Source[]; dropped: number; provenance: Provenance }> {
  const sources = buildSources(item, "fr");
  const answer = await provider.complete({
    system: argumentsSystem(),
    messages: [sourceMessage(sources, "List the arguments.")],
    maxTokens: 3000,
    signal: opts.signal,
  });
  const raw = parseJson<{ arguments?: Partial<Argument>[] }>(answer).arguments ?? [];
  const kept: Argument[] = [];
  for (const a of raw) {
    const stance = a.stance;
    if (stance !== "supports" && stance !== "opposes" && stance !== "asks_changes") continue;
    const source = Number(a.source);
    if (!quoteIsIn(a.quote, [source], sources)) continue;
    kept.push({
      id: `a${kept.length + 1}`,
      stance,
      by: String(a.by ?? ""),
      summary_en: String(a.summary_en ?? ""),
      source,
      quote: String(a.quote),
    });
  }
  return { arguments: kept, sources, dropped: raw.length - kept.length, provenance: provenance(provider, item) };
}

// ---------------------------------------------------------------- devil's advocate

export interface ChallengeTurn {
  reply: string;
  argument_ids: string[];
  sources: number[];
  /** True when the reply builds on at least one listed argument (Phase 1 target: 80% of turns). */
  grounded: boolean;
  provenance: Provenance;
}

export async function challenge(
  provider: Provider,
  item: DocketItem,
  opts: {
    lang: Lang;
    position: Position;
    arguments: Argument[];
    sources: Source[];
    history: ChatMessage[];
    signal?: AbortSignal;
  },
): Promise<ChallengeTurn> {
  const list = opts.arguments.length
    ? opts.arguments
        .map((a) => `- ${a.id} [${a.stance}] by ${a.by}: ${a.summary_en} (source ${a.source}: "${a.quote}")`)
        .join("\n")
    : "(none found in the official documents)";
  const first = sourceMessage(
    opts.sources,
    opts.history.length ? "Here are the sources for this conversation." : "Start the conversation.",
  );
  const messages: ChatMessage[] = opts.history.length
    ? [first, { role: "assistant", content: "Understood." }, ...opts.history]
    : [first];
  const answer = await provider.complete({
    system: challengeSystem(opts.lang, opts.position, list),
    messages,
    maxTokens: 1200,
    signal: opts.signal,
  });
  const raw = parseJson<{ reply?: string; argument_ids?: unknown[]; sources?: unknown[] }>(answer);
  const ids = new Set(opts.arguments.map((a) => a.id));
  const argumentIds = (raw.argument_ids ?? []).map(String).filter((id) => ids.has(id));
  const known = new Set(opts.sources.map((s) => s.n));
  return {
    reply: String(raw.reply ?? ""),
    argument_ids: argumentIds,
    sources: (raw.sources ?? []).map(Number).filter((n) => known.has(n)),
    grounded: argumentIds.length > 0,
    provenance: provenance(provider, item),
  };
}

// ---------------------------------------------------------------- claim check

export interface ClaimCheck {
  grade: GradeValue;
  explanation: string;
  evidence: { source: number; quote: string; url: string }[];
  /** True when the grade was lowered to yellow because the model's evidence didn't check out. */
  downgraded: boolean;
  provenance: Provenance;
}

export async function checkClaim(
  provider: Provider,
  item: DocketItem,
  opts: { lang: Lang; claim: string; signal?: AbortSignal },
): Promise<ClaimCheck> {
  const sources = buildSources(item, opts.lang);
  const answer = await provider.complete({
    system: claimSystem(opts.lang),
    messages: [sourceMessage(sources, `Claim to check: <claim>${opts.claim}</claim>`)],
    maxTokens: 1200,
    signal: opts.signal,
  });
  const raw = parseJson<{ grade?: string; explanation?: string; evidence?: { source?: unknown; quote?: unknown }[] }>(answer);
  const evidence = (raw.evidence ?? [])
    .map((e) => ({ source: Number(e.source), quote: String(e.quote ?? "") }))
    .filter((e) => quoteIsIn(e.quote, [e.source], sources))
    .map((e) => ({ ...e, url: sources.find((s) => s.n === e.source)?.url ?? "" }));
  let grade: GradeValue = raw.grade === "green" || raw.grade === "red" ? raw.grade : "yellow";
  // A green or red grade must stand on at least one verified quote. A false red is the costly error.
  const downgraded = grade !== "yellow" && evidence.length === 0;
  if (downgraded) grade = "yellow";
  return {
    grade,
    explanation: String(raw.explanation ?? ""),
    evidence,
    downgraded,
    provenance: provenance(provider, item),
  };
}
