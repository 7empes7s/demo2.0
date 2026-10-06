/** The shapes Desk answers with (modules/desk/src/desk.ts, auth.ts, db.ts), as the portal reads them. */

export const LANGS = ["lb", "fr", "de", "en", "pt"] as const;
export type Lang = (typeof LANGS)[number];
export type Localized = Partial<Record<Lang, string>>;

export const ROLES = ["operator", "admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export const CATEGORIES = ["roads", "waste", "green", "housing", "mobility", "safety", "culture", "admin", "budget", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PROCEDURE_KINDS = ["decision", "project", "consultation", "budget", "request"] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];
export const PROCEDURE_STATUSES = ["planned", "in_progress", "done", "stalled", "cancelled"] as const;
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];
export const IDEA_STATUSES = ["open", "taken_up", "answered", "declined", "merged"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const FEEDBACK_STATUSES = ["new", "in_review", "answered", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const ROUND_STATUSES = ["draft", "open", "closed", "published"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];
export type AboutKind = "none" | "procedure" | "idea";

export interface Staff {
  id: string;
  login: string;
  name: string;
  role: Role;
  disabled?: boolean;
  created_at?: string;
}

export interface Stage {
  name: Localized;
  planned?: string | null;
  done?: string | null;
}

export interface Link {
  label: string;
  url: string;
}

export interface Procedure {
  id: string;
  kind: ProcedureKind;
  status: ProcedureStatus;
  title: Localized;
  body: Localized;
  owner: string;
  stages: Stage[];
  links: Link[];
  docket_item_id: string | null;
  started_on: string | null;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  updates?: ProcedureUpdate[];
  verdicts?: Record<"done" | "needs_work" | "not_done", number>;
  answers?: PublicAnswer[];
  ideas?: { id: string; title: string; lang: Lang; status: IdeaStatus }[];
}

export interface ProcedureUpdate {
  id: string;
  procedure_id: string;
  at: string;
  text: Localized;
  status_after: ProcedureStatus;
}

export interface PublicAnswer {
  id: string;
  category: Category;
  lang: Lang;
  summary: string | null;
  answer: string;
  answered_at: string;
}

export interface Idea {
  id: string;
  lang: Lang;
  title: string;
  text: string;
  status: IdeaStatus;
  procedure_id: string | null;
  answer: Localized | null;
  answered_at: string | null;
  created_at: string;
  supporters: number;
}

export interface Feedback {
  id: string;
  code: string;
  enrolled: boolean;
  about_kind: AboutKind;
  about_id: string | null;
  category: Category;
  lang: Lang;
  text: string;
  status: FeedbackStatus;
  summary: string | null;
  answer: string | null;
  answer_public: boolean;
  answered_at: string | null;
  created_at: string;
}

export interface Tally {
  counts: number[];
  ballots: number;
  voters: number;
  tallied_at: string;
  ballots_sha256: string;
}

export interface Round {
  id: string;
  question: Localized;
  detail: Localized;
  options: Localized[];
  status: RoundStatus;
  about_kind: AboutKind;
  about_id: string | null;
  opens_at: string | null;
  closes_at: string | null;
  result: Tally | null;
  created_at: string;
  updated_at: string;
  ballots_so_far?: number | null;
}

export interface Ballot {
  voter: number;
  option: number;
  seq: number;
  at: string;
}

export interface AuditEvent {
  seq: number;
  at: string;
  kind: string;
  actor: string;
  subject: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
}

export interface Verification {
  ok: boolean;
  entries: number;
  head: string;
  broken_at: number | null;
}

export interface AiCall {
  at: string;
  purpose: string;
  model: string;
  prompt_sha256: string;
  input_chars: number;
  output_chars: number;
  ms: number;
  ok: number | boolean;
  error: string | null;
}

export interface PublicSettings {
  commune: string;
  languages: Lang[];
  intro: Localized;
  ai: { configured: boolean; model: string | null };
}

export interface AdminSettings extends PublicSettings {
  ai: { configured: boolean; model: string | null; base_url: string; key_set: boolean; from_env: boolean };
}

export interface EnrolBatch {
  batch: string;
  created_at: string;
  issued: number;
  used: number;
}

export interface Summary {
  log: Verification;
  counts: Record<string, number>;
  staff: { id: string; name: string; role: Role; disabled: boolean }[];
}
