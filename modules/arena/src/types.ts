/** The quiz format (spec/schemas/quiz.schema.json) and the part of a Docket item Arena reads. */

export const LANGS = ["lb", "fr", "de", "en", "pt"] as const;
export type Lang = (typeof LANGS)[number];

/** The same text in one or more of the five languages (spec/schemas/localized-text.schema.json). */
export type LocalizedText = Partial<Record<Lang, string>>;

export interface Evidence {
  /** Path into the Docket item, names and indexes joined by dots: `title.fr`, `agenda.0.steps.1`. */
  field: string;
  /** Copied word for word from that field. */
  quote: string;
  /** The item's official page or one of its documents. */
  url: string;
}

export interface Option {
  id: string;
  text: LocalizedText;
}

export interface Question {
  id: string;
  /** seed: written by hand and checked against a recorded snapshot. rules: generated from the item by fixed rules. */
  origin: "seed" | "rules";
  /** The seed set or rule set, with its version: `arena.seed/1`, `arena.rules/1`. */
  generator: string;
  prompt: LocalizedText;
  options: Option[];
  /** The id of the option the official text supports. */
  answer: string;
  evidence: Evidence[];
}

export interface Quiz {
  id: string;
  item_id: string;
  questions: Question[];
}

/**
 * The fields of a Docket snapshot item (d2.docket.snapshot/1 or /2) that Arena reads. Arena owns
 * this shape so it imports nothing from Docket or the Companion; a full Docket item fits it.
 */
export interface SourceItem {
  id: string;
  jurisdiction_id: string;
  type: string;
  type_label?: string | null;
  title: LocalizedText;
  status?: string | null;
  committee?: string | null;
  theme?: string | null;
  urls: LocalizedText;
  agenda: { steps: string[] }[];
  activities: { description: string; documents: { url: string }[] }[];
  documents: { url: string; text?: string }[];
  votes?: { counts: Record<string, number> } | null;
}
