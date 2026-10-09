/**
 * The commune's desk (the Desk service, forwarded by the Companion server under /api/desk).
 * Procedures, ideas, feedback and votes come from here when the served app's healthz says
 * `desk: true`. Residents sign in with a one-time enrolment code; the token it gives stays on
 * the device (prefs) and goes only to the desk. Feedback needs no sign-in.
 */

import type { Lang } from "@democracy2/companion";

import { CompanionFailure } from "./errors.ts";
import { prefs } from "./prefs.ts";

export type Localized = Partial<Record<Lang, string>>;

export const PROCEDURE_STATUSES = ["in_progress", "planned", "done", "stalled", "cancelled"] as const;
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];
export const PROCEDURE_KINDS = ["decision", "project", "consultation", "budget", "request"] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];
export const VERDICTS = ["done", "needs_work", "not_done"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const IDEA_STATUSES = ["open", "taken_up", "answered", "declined", "merged"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const FEEDBACK_STATUSES = ["new", "in_review", "answered", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const CATEGORIES = ["roads", "waste", "green", "housing", "mobility", "safety", "culture", "admin", "budget", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const ROUND_STATUSES = ["open", "closed", "published"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export interface Stage {
  name: Localized;
  planned?: string | null;
  done?: string | null;
}

export interface Procedure {
  id: string;
  kind: ProcedureKind;
  status: ProcedureStatus;
  title: Localized;
  body: Localized;
  owner: string;
  stages: Stage[];
  links: { label: string; url: string }[];
  started_on: string | null;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  verdicts: Record<Verdict, number>;
}

export interface ProcedureUpdate {
  id: string;
  at: string;
  text: Localized;
  status_after: ProcedureStatus;
}

/** A published answer on a procedure or an idea: the message's summary (when staff wrote one) and the answer. */
export interface PublishedAnswer {
  id: string;
  category: Category;
  lang: Lang;
  summary: string | null;
  answer: string;
  answered_at: string;
}

export interface ProcedureDetail extends Procedure {
  updates: ProcedureUpdate[];
  my_verdict: Verdict | null;
  answers: PublishedAnswer[];
  ideas: { id: string; title: string; lang: Lang; status: IdeaStatus }[];
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
  supported: boolean;
  mine: boolean;
  answers: PublishedAnswer[];
}

export type About = { kind: "procedure" | "idea"; id: string };

export interface FeedbackReceipt {
  code: string;
  status: FeedbackStatus;
  created_at: string;
}

export interface FeedbackLookup {
  code: string;
  status: FeedbackStatus;
  category: Category;
  lang: Lang;
  text: string;
  about_kind: "none" | "procedure" | "idea";
  about_id: string | null;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface Round {
  id: string;
  question: Localized;
  detail: Localized;
  options: Localized[];
  status: RoundStatus;
  about_kind: "none" | "procedure" | "idea";
  about_id: string | null;
  opens_at: string | null;
  closes_at: string | null;
  /** Only once published. */
  result: { counts: number[]; ballots: number; voters: number; tallied_at: string } | null;
  /** How many residents have voted, only while open. Never per option. */
  ballots_so_far: number | null;
}

export interface RoundDetail extends Round {
  my_ballot: { option: number; at: string } | null;
}

export interface LetterRequest {
  name: string;
  street: string;
  extra: string;
  postcode: string;
}

export interface DeskClient {
  /** Whether a token is on this device. The desk may still refuse it; the sheet then asks for a code again. */
  signedIn(): boolean;
  enrol(code: string): Promise<void>;
  /** Asks the commune to post a code. `already` when the same name and address are waiting already. */
  requestLetter(input: LetterRequest): Promise<{ already: boolean }>;
  signOut(): void;
  procedures(): Promise<Procedure[]>;
  procedure(id: string): Promise<ProcedureDetail>;
  verdict(id: string, verdict: Verdict): Promise<{ verdicts: Record<Verdict, number>; my_verdict: Verdict | null }>;
  ideas(): Promise<Idea[]>;
  postIdea(input: { lang: Lang; title: string; text: string }): Promise<Idea>;
  support(id: string, on: boolean): Promise<Idea>;
  feedback(input: { lang: Lang; text: string; category?: Category | null; about?: About | null }): Promise<FeedbackReceipt>;
  lookup(code: string): Promise<FeedbackLookup>;
  rounds(): Promise<Round[]>;
  round(id: string): Promise<RoundDetail>;
  ballot(id: string, option: number): Promise<{ option: number }>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isLocalized = (v: unknown): v is Localized => isObject(v) && Object.values(v).every(isText);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => allowed.includes(v as T);
const isCounts = (v: unknown): v is Record<Verdict, number> => isObject(v) && VERDICTS.every((k) => typeof v[k] === "number");
const answerOk = (v: unknown): v is PublishedAnswer => isObject(v) && isText(v.answer) && isText(v.answered_at);

function procedureOk(v: unknown): v is Procedure {
  return (
    isObject(v) &&
    isText(v.id) &&
    oneOf(v.kind, PROCEDURE_KINDS) &&
    oneOf(v.status, PROCEDURE_STATUSES) &&
    isLocalized(v.title) &&
    isLocalized(v.body) &&
    isText(v.owner) &&
    Array.isArray(v.stages) &&
    v.stages.every((s) => isObject(s) && isLocalized(s.name)) &&
    Array.isArray(v.links) &&
    v.links.every((l) => isObject(l) && isText(l.label) && isText(l.url)) &&
    isCounts(v.verdicts)
  );
}

function procedureDetailOk(v: unknown): v is ProcedureDetail {
  if (!procedureOk(v)) return false;
  const d = v as unknown as Record<string, unknown>;
  return (
    Array.isArray(d.updates) &&
    d.updates.every((u: unknown) => isObject(u) && isText(u.at) && isLocalized(u.text)) &&
    Array.isArray(d.answers) &&
    d.answers.every(answerOk) &&
    Array.isArray(d.ideas) &&
    d.ideas.every((i: unknown) => isObject(i) && isText(i.title) && oneOf(i.status, IDEA_STATUSES))
  );
}

function ideaOk(v: unknown): v is Idea {
  return (
    isObject(v) &&
    isText(v.id) &&
    isText(v.title) &&
    isText(v.text) &&
    isText(v.lang) &&
    oneOf(v.status, IDEA_STATUSES) &&
    typeof v.supporters === "number" &&
    typeof v.supported === "boolean" &&
    typeof v.mine === "boolean" &&
    (v.answer === null || v.answer === undefined || isLocalized(v.answer)) &&
    Array.isArray(v.answers) &&
    v.answers.every(answerOk)
  );
}

function roundOk(v: unknown): v is Round {
  return (
    isObject(v) &&
    isText(v.id) &&
    isLocalized(v.question) &&
    isLocalized(v.detail) &&
    Array.isArray(v.options) &&
    v.options.every(isLocalized) &&
    oneOf(v.status, ROUND_STATUSES) &&
    (v.result === null || (isObject(v.result) && Array.isArray(v.result.counts) && v.result.counts.every((n) => typeof n === "number")))
  );
}

/**
 * Talks to the desk through the Companion server. 429 is "busy", 401 and 403 "signin" (the token
 * on the device is dropped so the sheet asks for a code again), 404 "not found", 5xx and no
 * answer "unavailable". An answer of an unexpected shape is "unavailable" too, so a page never
 * shows what it does not understand.
 */
export class RemoteDesk implements DeskClient {
  private readonly base: string;
  constructor(base = "") {
    this.base = base;
  }

  signedIn() {
    return !!prefs.deskToken();
  }

  signOut() {
    prefs.setDeskToken(null);
  }

  async enrol(code: string) {
    const body = await this.call("POST", "enrol", { code }, false);
    if (!isObject(body) || !isText(body.token) || !body.token) throw new CompanionFailure("unavailable");
    prefs.setDeskToken(body.token);
  }

  async requestLetter(input: LetterRequest) {
    const body = await this.call("POST", "enrol-requests", { ...input }, false);
    if (!isObject(body) || body.received !== true) throw new CompanionFailure("unavailable");
    return { already: body.already === true };
  }

  private async call(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, auth = true): Promise<unknown> {
    const headers: Record<string, string> = {};
    const token = auth ? prefs.deskToken() : null;
    if (token) headers.authorization = `Resident ${token}`;
    if (body) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/desk/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new CompanionFailure("unavailable");
    }
    if (res.status === 429) throw new CompanionFailure("busy");
    if (res.status === 401 || res.status === 403) {
      if (token) prefs.setDeskToken(null);
      throw new CompanionFailure("signin");
    }
    if (res.status === 404) throw new CompanionFailure("not_found");
    if (res.status >= 500) throw new CompanionFailure("unavailable");
    const parsed = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw new Error(isObject(parsed) && isText(parsed.error) ? parsed.error : `desk: ${res.status}`);
    return parsed;
  }

  private async list<T>(path: string, key: string, ok: (v: unknown) => v is T): Promise<T[]> {
    const body = await this.call("GET", path);
    const items = isObject(body) ? body[key] : null;
    if (!Array.isArray(items) || !items.every(ok)) throw new CompanionFailure("unavailable");
    return items;
  }

  private async one<T>(method: "GET" | "POST" | "DELETE", path: string, ok: (v: unknown) => v is T, body?: Record<string, unknown>, auth = true): Promise<T> {
    const answer = await this.call(method, path, body, auth);
    if (!ok(answer)) throw new CompanionFailure("unavailable");
    return answer;
  }

  procedures() {
    return this.list("procedures", "procedures", procedureOk);
  }
  procedure(id: string) {
    return this.one("GET", `procedures/${encodeURIComponent(id)}`, procedureDetailOk);
  }
  verdict(id: string, verdict: Verdict) {
    const ok = (v: unknown): v is { verdicts: Record<Verdict, number>; my_verdict: Verdict | null } => isObject(v) && isCounts(v.verdicts);
    return this.one("POST", `procedures/${encodeURIComponent(id)}/verdict`, ok, { verdict });
  }
  ideas() {
    return this.list("ideas", "ideas", ideaOk);
  }
  postIdea(input: { lang: Lang; title: string; text: string }) {
    return this.one("POST", "ideas", ideaOk, input);
  }
  support(id: string, on: boolean) {
    return this.one(on ? "POST" : "DELETE", `ideas/${encodeURIComponent(id)}/support`, ideaOk);
  }
  feedback(input: { lang: Lang; text: string; category?: Category | null; about?: About | null }) {
    const body: Record<string, unknown> = { lang: input.lang, text: input.text };
    if (input.category) body.category = input.category;
    if (input.about) body.about = input.about;
    const ok = (v: unknown): v is FeedbackReceipt => isObject(v) && isText(v.code) && oneOf(v.status, FEEDBACK_STATUSES);
    return this.one("POST", "feedback", ok, body);
  }
  lookup(code: string) {
    const ok = (v: unknown): v is FeedbackLookup => isObject(v) && isText(v.code) && oneOf(v.status, FEEDBACK_STATUSES) && isText(v.text) && (v.answer === null || isText(v.answer));
    return this.one("GET", `feedback/by-code/${encodeURIComponent(code.trim())}`, ok, undefined, false);
  }
  rounds() {
    return this.list("rounds", "rounds", roundOk);
  }
  round(id: string) {
    return this.one("GET", `rounds/${encodeURIComponent(id)}`, (v): v is RoundDetail => roundOk(v) && "my_ballot" in v);
  }
  ballot(id: string, option: number) {
    return this.one("POST", `rounds/${encodeURIComponent(id)}/ballots`, (v): v is { option: number } => isObject(v) && typeof v.option === "number", { option });
  }
}

/** When the reader's language is missing, the first of these that the text has is shown. */
const FALLBACK: readonly Lang[] = ["fr", "de", "lb", "en", "pt"];

/** The text in `lang` if it exists, else in the first fallback language it has. */
export function localizedText(text: Localized | null | undefined, lang: Lang): { lang: Lang; text: string } | null {
  if (!text) return null;
  for (const l of [lang, ...FALLBACK]) {
    const value = text[l];
    if (typeof value === "string" && value) return { lang: l, text: value };
  }
  return null;
}

/** Which stage a procedure is at: the first one not done, or the last when every stage is done. */
export function currentStage(stages: Stage[]): number {
  const next = stages.findIndex((s) => !s.done);
  return next === -1 ? stages.length - 1 : next;
}

/** Per option, the share of ballots as a whole percentage (all 0 when no ballot was cast). */
export function shares(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((n) => (total ? Math.round((n / total) * 100) : 0));
}
