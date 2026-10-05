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
  /** null for a document Docket lists by URL only (not fetched yet). */
  fetched_at?: string | null;
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

/** How each member of a council voted on one point, as the council publishes it (values in French, e.g. "Oui"). */
export interface DocketVotes {
  counts: Record<string, number>;
  by_party: Record<string, Record<string, number>>;
  members: { name: string | null; party: string | null; vote: string | null }[];
}

/** One item of the Docket snapshot (d2.docket.snapshot/1 or /2). */
export interface DocketItem {
  id: string;
  source: string;
  /** "lu" for the Chamber of Deputies, "lu-esch" for Esch-sur-Alzette. */
  jurisdiction_id: string;
  /** The Chamber's dossier number or the council's point number; null for consultations. */
  number: string | null;
  /** "agenda" is a point on a municipal council's agenda (snapshot/2). */
  type: "bill" | "debate" | "agenda" | "other";
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
  // Council agenda points (snapshot/2)
  reference?: string | null;
  theme?: string | null;
  votes?: DocketVotes | null;
  // Consultations (snapshot/2)
  summary?: string | null;
  when?: string | null;
  opens?: string | null;
  closes?: string | null;
  phases?: { title: string; start: string | null; end: string | null }[];
}

export interface DocketMeeting {
  /** The site it was read from, e.g. "chd.lu" or "esch.lu" (snapshot/2). */
  source?: string;
  id: string;
  date: string | null;
  time: string | null;
  body: string;
  location?: string | null;
  url?: string | null;
  points: { text: string; dossier: string | null; steps: string[] }[];
}

/** One site Docket read, e.g. { id: "chd", name: "Chambre des Députés", url, sha256 }. */
export interface DocketSource {
  id: string;
  name?: string;
  url?: string;
  sha256?: string;
}

export interface DocketError {
  source?: string;
  error: string;
  [key: string]: unknown;
}

/**
 * The Docket snapshot, always in the snapshot/2 shape: `readSnapshot` turns a /1 snapshot
 * (one `source`) into this (a `sources` list).
 */
export interface DocketSnapshot {
  schema: string;
  generated_at: string;
  sources?: DocketSource[];
  meetings?: DocketMeeting[];
  items: DocketItem[];
  errors?: DocketError[];
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
