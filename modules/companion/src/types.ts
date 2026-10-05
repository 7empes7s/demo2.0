/** Shapes shared by the Companion core, the server and the citizen app. */

export const LANGS = ["lb", "fr", "de", "en", "pt"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = {
  lb: "Luxembourgish",
  fr: "French",
  de: "German",
  en: "English",
  pt: "Portuguese",
};

/** A document as Docket stores it (text already extracted, possibly truncated). */
export interface DocketDocument {
  label: string;
  url: string;
  date?: string | null;
  kind: string;
  sha256?: string | null;
  text: string;
  truncated?: boolean;
  error?: string;
}

export interface DocketAgendaEntry {
  meeting_id: string;
  date: string | null;
  time: string | null;
  body: string;
  steps: string[];
}

export interface DocketActivity {
  date: string | null;
  kind: string;
  description: string;
  actors: string[];
  documents: { label: string; url: string; kind: string }[];
}

/** One item of the Docket snapshot (d2.docket.snapshot/1). */
export interface DocketItem {
  id: string;
  source: string;
  jurisdiction_id: string;
  number: string;
  type: "bill" | "other";
  type_label: string | null;
  title: Partial<Record<Lang, string>>;
  status: string | null;
  author: string | null;
  committee: string | null;
  deposited: string | null;
  updated: string | null;
  urls: Partial<Record<Lang, string>>;
  agenda: DocketAgendaEntry[];
  activities: DocketActivity[];
  documents: DocketDocument[];
}

export interface DocketSnapshot {
  schema: string;
  generated_at: string;
  items: DocketItem[];
}

/** A numbered source handed to the model. Citations refer to `n`. */
export interface Source {
  n: number;
  label: string;
  url: string;
  date?: string | null;
  text: string;
}

/** A sentence plus the sources and verbatim quotes that back it. */
export interface CitedSentence {
  text: string;
  sources: number[];
  quote?: string;
  /** The quote was found word for word in a cited source. It does not prove the sentence follows from it. */
  verified: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type Position = "for" | "against" | "unsure";
export type Depth = "short" | "standard" | "deep";
export type GradeValue = "green" | "yellow" | "red";
