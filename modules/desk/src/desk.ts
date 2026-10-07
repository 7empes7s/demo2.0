/**
 * What residents and staff can do, as plain functions over the store. Every change is an
 * appended event (see db.ts). Text residents write is kept in the tables; the event log keeps
 * only its length and hash, so the audit view never shows a resident's words.
 */

import { DeskError } from "./auth.ts";
import { CATEGORIES, type Category, type Lang, LANGS } from "./ai.ts";
import { newId, sha256, Store } from "./db.ts";

export type Localized = Partial<Record<Lang, string>>;

export const PROCEDURE_KINDS = ["decision", "project", "consultation", "budget", "request"] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];
export const PROCEDURE_STATUSES = ["planned", "in_progress", "done", "stalled", "cancelled"] as const;
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];
export const VERDICTS = ["done", "needs_work", "not_done"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const IDEA_STATUSES = ["open", "taken_up", "answered", "declined", "merged"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const FEEDBACK_STATUSES = ["new", "in_review", "answered", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const ROUND_STATUSES = ["draft", "open", "closed", "published"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];
export const ABOUT_KINDS = ["none", "procedure", "idea"] as const;
export type AboutKind = (typeof ABOUT_KINDS)[number];

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
  docket_item_id: string | null;
  started_on: string | null;
  due_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcedureUpdate {
  id: string;
  procedure_id: string;
  at: string;
  text: Localized;
  status_after: ProcedureStatus;
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
  result: { counts: number[]; ballots: number; voters: number; tallied_at: string; ballots_sha256: string } | null;
  created_at: string;
  updated_at: string;
}

const MAX_TEXT = 4000;
const MAX_TITLE = 140;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value as T)) throw new DeskError(400, `${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function text(value: unknown, what: string, max = MAX_TEXT, min = 1): string {
  if (typeof value !== "string") throw new DeskError(400, `${what} must be text`);
  const s = value.replace(/\r\n?/g, "\n").trim();
  if ([...s].length < min) throw new DeskError(400, `${what} is empty`);
  if ([...s].length > max) throw new DeskError(413, `${what} is longer than ${max} characters`);
  return s;
}

/** A text in one or more of the five languages; at least one must be given. */
export function localized(value: unknown, what: string, max = MAX_TEXT, required = true): Localized {
  if (value === undefined || value === null) {
    if (required) throw new DeskError(400, `${what} is missing`);
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) throw new DeskError(400, `${what} must be an object with language keys`);
  const out: Localized = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!(LANGS as readonly string[]).includes(k)) throw new DeskError(400, `${what}: unknown language ${String(k).slice(0, 10)}`);
    if (typeof v !== "string") throw new DeskError(400, `${what}.${k} must be text`);
    const s = v.replace(/\r\n?/g, "\n").trim();
    if (!s) continue;
    if ([...s].length > max) throw new DeskError(413, `${what}.${k} is longer than ${max} characters`);
    out[k as Lang] = s;
  }
  if (required && !Object.keys(out).length) throw new DeskError(400, `${what} needs text in at least one language`);
  return out;
}

function date(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new DeskError(400, `${what} must be a date like 2026-10-06`);
  return value;
}

function instant(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new DeskError(400, `${what} must be a date and time`);
  return new Date(value).toISOString();
}

function parse<T>(json: string): T {
  return JSON.parse(json) as T;
}

/* ------------------------------------------------------------------ procedures */

function rowToProcedure(r: Record<string, unknown>): Procedure {
  return {
    id: r.id as string,
    kind: r.kind as ProcedureKind,
    status: r.status as ProcedureStatus,
    title: parse(r.title as string),
    body: parse(r.body as string),
    owner: r.owner as string,
    stages: parse(r.stages as string),
    links: parse(r.links as string),
    docket_item_id: (r.docket_item_id as string | null) ?? null,
    started_on: (r.started_on as string | null) ?? null,
    due_on: (r.due_on as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

function procedureInput(body: Record<string, unknown>, existing?: Procedure) {
  const kind = body.kind === undefined && existing ? existing.kind : oneOf(body.kind, PROCEDURE_KINDS, "kind");
  const status = body.status === undefined && existing ? existing.status : oneOf(body.status, PROCEDURE_STATUSES, "status");
  const title = body.title === undefined && existing ? existing.title : localized(body.title, "title", MAX_TITLE);
  const bodyText = body.body === undefined && existing ? existing.body : localized(body.body, "body", MAX_TEXT, false);
  const owner = body.owner === undefined && existing ? existing.owner : text(body.owner, "owner", 120);
  let stages: Stage[] = existing?.stages ?? [];
  if (body.stages !== undefined) {
    if (!Array.isArray(body.stages) || body.stages.length > 20) throw new DeskError(400, "stages must be a list of at most 20");
    stages = body.stages.map((s: unknown) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { name: localized(o.name, "stage name", MAX_TITLE), planned: date(o.planned, "stage planned date"), done: date(o.done, "stage done date") };
    });
  }
  let links: { label: string; url: string }[] = existing?.links ?? [];
  if (body.links !== undefined) {
    if (!Array.isArray(body.links) || body.links.length > 20) throw new DeskError(400, "links must be a list of at most 20");
    links = body.links.map((l: unknown) => {
      const o = (l ?? {}) as Record<string, unknown>;
      const url = text(o.url, "link url", 500);
      if (!/^https?:\/\//.test(url)) throw new DeskError(400, "a link must start with http:// or https://");
      return { label: text(o.label, "link label", 120), url };
    });
  }
  const docket_item_id = body.docket_item_id === undefined ? (existing?.docket_item_id ?? null) : body.docket_item_id === null || body.docket_item_id === "" ? null : text(body.docket_item_id, "docket_item_id", 80);
  const started_on = body.started_on === undefined ? (existing?.started_on ?? null) : date(body.started_on, "started_on");
  const due_on = body.due_on === undefined ? (existing?.due_on ?? null) : date(body.due_on, "due_on");
  return { kind, status, title, body: bodyText, owner, stages, links, docket_item_id, started_on, due_on };
}

export function createProcedure(store: Store, by: string, body: Record<string, unknown>): Procedure {
  const input = procedureInput(body);
  const id = newId();
  const at = store.now();
  store.append("procedure.created", by, `procedure:${id}`, { kind: input.kind, status: input.status, title: input.title, owner: input.owner }, () => {
    store.db
      .prepare(
        "INSERT INTO procedures (id, kind, status, title, body, owner, stages, links, docket_item_id, started_on, due_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.kind, input.status, JSON.stringify(input.title), JSON.stringify(input.body), input.owner, JSON.stringify(input.stages), JSON.stringify(input.links), input.docket_item_id, input.started_on, input.due_on, at, at);
  });
  return getProcedure(store, id)!;
}

export function updateProcedure(store: Store, by: string, id: string, body: Record<string, unknown>): Procedure {
  const existing = getProcedure(store, id);
  if (!existing) throw new DeskError(404, "no such procedure");
  const input = procedureInput(body, existing);
  const at = store.now();
  store.append("procedure.updated", by, `procedure:${id}`, { status: input.status, title: input.title, fields: Object.keys(body).sort() }, () => {
    store.db
      .prepare("UPDATE procedures SET kind = ?, status = ?, title = ?, body = ?, owner = ?, stages = ?, links = ?, docket_item_id = ?, started_on = ?, due_on = ?, updated_at = ? WHERE id = ?")
      .run(input.kind, input.status, JSON.stringify(input.title), JSON.stringify(input.body), input.owner, JSON.stringify(input.stages), JSON.stringify(input.links), input.docket_item_id, input.started_on, input.due_on, at, id);
  });
  return getProcedure(store, id)!;
}

/** A dated note from the commune on a procedure, with the status it leaves the procedure in. */
export function addProcedureUpdate(store: Store, by: string, procedureId: string, body: Record<string, unknown>): ProcedureUpdate {
  const existing = getProcedure(store, procedureId);
  if (!existing) throw new DeskError(404, "no such procedure");
  const noteText = localized(body.text, "text");
  const status_after = body.status === undefined ? existing.status : oneOf(body.status, PROCEDURE_STATUSES, "status");
  const id = newId();
  const at = store.now();
  store.append("procedure.update_posted", by, `procedure:${procedureId}`, { update_id: id, status_after, text: noteText }, () => {
    store.db.prepare("INSERT INTO procedure_updates (id, procedure_id, at, text, status_after, staff_id) VALUES (?, ?, ?, ?, ?, ?)").run(id, procedureId, at, JSON.stringify(noteText), status_after, by);
    store.db.prepare("UPDATE procedures SET status = ?, updated_at = ? WHERE id = ?").run(status_after, at, procedureId);
  });
  return { id, procedure_id: procedureId, at, text: noteText, status_after };
}

export function getProcedure(store: Store, id: string): Procedure | null {
  const row = store.db.prepare("SELECT * FROM procedures WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToProcedure(row) : null;
}

export function listProcedures(store: Store, opts: { status?: string; kind?: string } = {}): Procedure[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.status) {
    where.push("status = ?");
    args.push(oneOf(opts.status, PROCEDURE_STATUSES, "status"));
  }
  if (opts.kind) {
    where.push("kind = ?");
    args.push(oneOf(opts.kind, PROCEDURE_KINDS, "kind"));
  }
  const rows = store.db.prepare(`SELECT * FROM procedures ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, id`).all(...args) as Record<string, unknown>[];
  return rows.map(rowToProcedure);
}

export function procedureUpdates(store: Store, procedureId: string): ProcedureUpdate[] {
  const rows = store.db.prepare("SELECT id, procedure_id, at, text, status_after FROM procedure_updates WHERE procedure_id = ? ORDER BY at DESC, id").all(procedureId) as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as string, procedure_id: r.procedure_id as string, at: r.at as string, text: parse(r.text as string), status_after: r.status_after as ProcedureStatus }));
}

/** The last word of each resident counts. Counts only; who said what stays in the table. */
export function verdictCounts(store: Store, procedureId: string): Record<Verdict, number> {
  const rows = store.db
    .prepare("SELECT verdict, COUNT(*) AS n FROM (SELECT resident_id, verdict, MAX(at) FROM verdicts WHERE procedure_id = ? GROUP BY resident_id) GROUP BY verdict")
    .all(procedureId) as { verdict: Verdict; n: number }[];
  const counts: Record<Verdict, number> = { done: 0, needs_work: 0, not_done: 0 };
  for (const r of rows) counts[r.verdict] = r.n;
  return counts;
}

export function myVerdict(store: Store, procedureId: string, residentId: string): Verdict | null {
  const row = store.db.prepare("SELECT verdict FROM verdicts WHERE procedure_id = ? AND resident_id = ? ORDER BY at DESC, id DESC LIMIT 1").get(procedureId, residentId) as { verdict: Verdict } | undefined;
  return row?.verdict ?? null;
}

/** "Did they do it?": only once the commune says a procedure is done (or stalled or cancelled). */
export function giveVerdict(store: Store, residentId: string, procedureId: string, body: Record<string, unknown>): Record<Verdict, number> {
  const p = getProcedure(store, procedureId);
  if (!p) throw new DeskError(404, "no such procedure");
  if (p.status === "planned" || p.status === "in_progress") throw new DeskError(409, "this procedure is not finished yet");
  const verdict = oneOf(body.verdict, VERDICTS, "verdict");
  const id = newId();
  store.append("procedure.verdict", `resident:${residentId}`, `procedure:${procedureId}`, { verdict }, () => {
    store.db.prepare("INSERT INTO verdicts (id, procedure_id, resident_id, verdict, at) VALUES (?, ?, ?, ?, ?)").run(id, procedureId, residentId, verdict, store.now());
  });
  return verdictCounts(store, procedureId);
}

/* ------------------------------------------------------------------ ideas */

function rowToIdea(r: Record<string, unknown>): Idea {
  return {
    id: r.id as string,
    lang: r.lang as Lang,
    title: r.title as string,
    text: r.text as string,
    status: r.status as IdeaStatus,
    procedure_id: (r.procedure_id as string | null) ?? null,
    answer: r.answer ? parse(r.answer as string) : null,
    answered_at: (r.answered_at as string | null) ?? null,
    created_at: r.created_at as string,
    supporters: Number(r.supporters ?? 0),
  };
}

const IDEA_SELECT = "SELECT i.*, (SELECT COUNT(*) FROM supports s WHERE s.idea_id = i.id) AS supporters FROM ideas i";

export function postIdea(store: Store, residentId: string, body: Record<string, unknown>): Idea {
  const lang = oneOf(body.lang, LANGS, "lang");
  const title = text(body.title, "title", MAX_TITLE, 3);
  const ideaText = text(body.text, "text", MAX_TEXT, 10);
  // One idea per resident per hour, so one person cannot flood the list.
  const recent = store.db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE resident_id = ? AND created_at > ?").get(residentId, new Date(Date.parse(store.now()) - 3_600_000).toISOString()) as { n: number };
  if (recent.n >= 1) throw new DeskError(429, "one idea per hour; try again later");
  const id = newId();
  const at = store.now();
  store.append("idea.posted", `resident:${residentId}`, `idea:${id}`, { lang, title, text_sha256: sha256(ideaText), text_chars: [...ideaText].length }, () => {
    store.db.prepare("INSERT INTO ideas (id, resident_id, lang, title, text, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)").run(id, residentId, lang, title, ideaText, at);
  });
  return getIdea(store, id)!;
}

export function getIdea(store: Store, id: string): Idea | null {
  const row = store.db.prepare(`${IDEA_SELECT} WHERE i.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToIdea(row) : null;
}

export function listIdeas(store: Store, opts: { status?: string; limit?: number } = {}): Idea[] {
  const args: (string | number)[] = [];
  let where = "";
  if (opts.status) {
    where = "WHERE i.status = ?";
    args.push(oneOf(opts.status, IDEA_STATUSES, "status"));
  }
  args.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const rows = store.db.prepare(`${IDEA_SELECT} ${where} ORDER BY supporters DESC, i.created_at DESC, i.id LIMIT ?`).all(...args) as Record<string, unknown>[];
  return rows.map(rowToIdea);
}

export function support(store: Store, residentId: string, ideaId: string, on: boolean): Idea {
  const idea = getIdea(store, ideaId);
  if (!idea) throw new DeskError(404, "no such idea");
  if (idea.status !== "open" && idea.status !== "taken_up") throw new DeskError(409, "this idea is closed");
  const owner = store.db.prepare("SELECT resident_id FROM ideas WHERE id = ?").get(ideaId) as { resident_id: string };
  if (owner.resident_id === residentId) throw new DeskError(403, "you cannot support your own idea");
  const has = !!store.db.prepare("SELECT 1 FROM supports WHERE idea_id = ? AND resident_id = ?").get(ideaId, residentId);
  if (on === has) return idea;
  store.append(on ? "idea.supported" : "idea.support_withdrawn", `resident:${residentId}`, `idea:${ideaId}`, {}, () => {
    if (on) store.db.prepare("INSERT INTO supports (idea_id, resident_id, at) VALUES (?, ?, ?)").run(ideaId, residentId, store.now());
    else store.db.prepare("DELETE FROM supports WHERE idea_id = ? AND resident_id = ?").run(ideaId, residentId);
  });
  return getIdea(store, ideaId)!;
}

export function supports(store: Store, residentId: string, ideaId: string): boolean {
  return !!store.db.prepare("SELECT 1 FROM supports WHERE idea_id = ? AND resident_id = ?").get(ideaId, residentId);
}

export function isProposer(store: Store, residentId: string, ideaId: string): boolean {
  return !!store.db.prepare("SELECT 1 FROM ideas WHERE id = ? AND resident_id = ?").get(ideaId, residentId);
}

/** The commune's decision on an idea: taken up (as a procedure), answered, declined or merged. */
export function decideIdea(store: Store, by: string, ideaId: string, body: Record<string, unknown>): Idea {
  const idea = getIdea(store, ideaId);
  if (!idea) throw new DeskError(404, "no such idea");
  const status = oneOf(body.status, IDEA_STATUSES, "status");
  const answer = body.answer === undefined || body.answer === null ? idea.answer : localized(body.answer, "answer", MAX_TEXT, false);
  if (status !== "open" && !(answer && Object.keys(answer).length)) throw new DeskError(400, "an answer is needed to close, take up, decline or merge an idea");
  let procedure_id: string | null = idea.procedure_id;
  if (body.procedure_id !== undefined) {
    procedure_id = body.procedure_id === null || body.procedure_id === "" ? null : text(body.procedure_id, "procedure_id", 40);
    if (procedure_id && !getProcedure(store, procedure_id)) throw new DeskError(404, "no such procedure");
  }
  if (status === "taken_up" && !procedure_id) throw new DeskError(400, "a taken-up idea names the procedure that follows it");
  const at = store.now();
  store.append("idea.decided", by, `idea:${ideaId}`, { status, procedure_id, answer }, () => {
    store.db.prepare("UPDATE ideas SET status = ?, procedure_id = ?, answer = ?, answered_at = ? WHERE id = ?").run(status, procedure_id, answer ? JSON.stringify(answer) : null, status === "open" ? null : at, ideaId);
  });
  return getIdea(store, ideaId)!;
}

/* ------------------------------------------------------------------ feedback */

function rowToFeedback(r: Record<string, unknown>): Feedback {
  return {
    id: r.id as string,
    code: r.code as string,
    enrolled: !!r.resident_id,
    about_kind: r.about_kind as AboutKind,
    about_id: (r.about_id as string | null) ?? null,
    category: r.category as Category,
    lang: r.lang as Lang,
    text: r.text as string,
    status: r.status as FeedbackStatus,
    summary: (r.summary as string | null) ?? null,
    answer: (r.answer as string | null) ?? null,
    answer_public: !!r.answer_public,
    answered_at: (r.answered_at as string | null) ?? null,
    created_at: r.created_at as string,
  };
}

function about(store: Store, body: Record<string, unknown>): { about_kind: AboutKind; about_id: string | null } {
  if (body.about === undefined || body.about === null) return { about_kind: "none", about_id: null };
  const o = body.about as Record<string, unknown>;
  const about_kind = oneOf(o.kind, ABOUT_KINDS, "about.kind");
  if (about_kind === "none") return { about_kind, about_id: null };
  const about_id = text(o.id, "about.id", 40);
  const found = about_kind === "procedure" ? getProcedure(store, about_id) : getIdea(store, about_id);
  if (!found) throw new DeskError(404, `no such ${about_kind}`);
  return { about_kind, about_id };
}

/** Anyone may write; an enrolled resident's message is marked as such. The code is the receipt. */
export function fileFeedback(store: Store, residentId: string | null, body: Record<string, unknown>): Feedback {
  const lang = oneOf(body.lang, LANGS, "lang");
  const message = text(body.text, "text", MAX_TEXT, 5);
  const category = body.category === undefined || body.category === null || body.category === "" ? "other" : oneOf(body.category, CATEGORIES, "category");
  const link = about(store, body);
  const id = newId();
  const code = newId(8);
  const at = store.now();
  store.append("feedback.filed", residentId ? `resident:${residentId}` : "anonymous", `feedback:${id}`, { lang, category, ...link, text_sha256: sha256(message), text_chars: [...message].length }, () => {
    store.db
      .prepare("INSERT INTO feedback (id, code, resident_id, about_kind, about_id, category, lang, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)")
      .run(id, code, residentId, link.about_kind, link.about_id, category, lang, message, at);
  });
  return getFeedback(store, id)!;
}

export function getFeedback(store: Store, id: string): Feedback | null {
  const row = store.db.prepare("SELECT * FROM feedback WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToFeedback(row) : null;
}

export function feedbackByCode(store: Store, code: string): Feedback | null {
  const row = store.db.prepare("SELECT * FROM feedback WHERE code = ?").get(code.trim().toLowerCase()) as Record<string, unknown> | undefined;
  return row ? rowToFeedback(row) : null;
}

export function listFeedback(store: Store, opts: { status?: string; about_kind?: string; about_id?: string; limit?: number } = {}): Feedback[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.status) {
    where.push("status = ?");
    args.push(oneOf(opts.status, FEEDBACK_STATUSES, "status"));
  }
  if (opts.about_kind) {
    where.push("about_kind = ?");
    args.push(oneOf(opts.about_kind, ABOUT_KINDS, "about_kind"));
  }
  if (opts.about_id) {
    where.push("about_id = ?");
    args.push(opts.about_id);
  }
  args.push(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
  const rows = store.db.prepare(`SELECT * FROM feedback ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id LIMIT ?`).all(...args) as Record<string, unknown>[];
  return rows.map(rowToFeedback);
}

/** Published answers on a procedure or an idea: the question's summary (or nothing) and the answer. */
export function publicAnswers(store: Store, aboutKind: AboutKind, aboutId: string): { id: string; category: Category; lang: Lang; summary: string | null; answer: string; answered_at: string }[] {
  return store.db
    .prepare("SELECT id, category, lang, summary, answer, answered_at FROM feedback WHERE about_kind = ? AND about_id = ? AND answer_public = 1 AND answer IS NOT NULL ORDER BY answered_at DESC")
    .all(aboutKind, aboutId) as unknown as { id: string; category: Category; lang: Lang; summary: string | null; answer: string; answered_at: string }[];
}

export function reviewFeedback(store: Store, by: string, id: string, body: Record<string, unknown>): Feedback {
  const f = getFeedback(store, id);
  if (!f) throw new DeskError(404, "no such feedback");
  const status = body.status === undefined ? f.status : oneOf(body.status, FEEDBACK_STATUSES, "status");
  const category = body.category === undefined ? f.category : oneOf(body.category, CATEGORIES, "category");
  const summary = body.summary === undefined ? f.summary : body.summary === null ? null : text(body.summary, "summary", 300);
  store.append("feedback.reviewed", by, `feedback:${id}`, { status, category, summary_set: summary !== f.summary }, () => {
    store.db.prepare("UPDATE feedback SET status = ?, category = ?, summary = ? WHERE id = ?").run(status, category, summary, id);
  });
  return getFeedback(store, id)!;
}

export function answerFeedback(store: Store, by: string, id: string, body: Record<string, unknown>): Feedback {
  const f = getFeedback(store, id);
  if (!f) throw new DeskError(404, "no such feedback");
  const answer = text(body.answer, "answer", MAX_TEXT, 2);
  const publish = body.publish === true;
  if (publish && f.about_kind === "none") throw new DeskError(400, "only an answer about a procedure or an idea can be published");
  const at = store.now();
  store.append("feedback.answered", by, `feedback:${id}`, { public: publish, answer_sha256: sha256(answer), answer_chars: [...answer].length }, () => {
    store.db.prepare("UPDATE feedback SET answer = ?, answer_public = ?, answered_at = ?, staff_id = ?, status = 'answered' WHERE id = ?").run(answer, publish ? 1 : 0, at, by, id);
  });
  return getFeedback(store, id)!;
}

/* ------------------------------------------------------------------ rounds (votes) */

function rowToRound(r: Record<string, unknown>): Round {
  return {
    id: r.id as string,
    question: parse(r.question as string),
    detail: parse(r.detail as string),
    options: parse(r.options as string),
    status: r.status as RoundStatus,
    about_kind: r.about_kind as AboutKind,
    about_id: (r.about_id as string | null) ?? null,
    opens_at: (r.opens_at as string | null) ?? null,
    closes_at: (r.closes_at as string | null) ?? null,
    result: r.result ? parse(r.result as string) : null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

export function createRound(store: Store, by: string, body: Record<string, unknown>): Round {
  const input = roundInput(store, body);
  const id = newId();
  const at = store.now();
  store.append("round.created", by, `round:${id}`, { question: input.question, options: input.options, about_kind: input.about_kind, about_id: input.about_id, closes_at: input.closes_at }, () => {
    store.db
      .prepare("INSERT INTO rounds (id, question, detail, options, status, about_kind, about_id, opens_at, closes_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, ?, ?)")
      .run(id, JSON.stringify(input.question), JSON.stringify(input.detail), JSON.stringify(input.options), input.about_kind, input.about_id, input.closes_at, by, at, at);
  });
  return getRound(store, id)!;
}

function roundInput(store: Store, body: Record<string, unknown>, existing?: Round) {
  const question = body.question === undefined && existing ? existing.question : localized(body.question, "question", 300);
  const detail = body.detail === undefined && existing ? existing.detail : localized(body.detail, "detail", MAX_TEXT, false);
  let options = existing?.options ?? [];
  if (body.options !== undefined || !existing) {
    if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 12) throw new DeskError(400, "options must be a list of 2 to 12");
    options = body.options.map((o: unknown) => localized(o, "option", MAX_TITLE));
  }
  const link = body.about === undefined && existing ? { about_kind: existing.about_kind, about_id: existing.about_id } : about(store, body);
  const closes_at = body.closes_at === undefined && existing ? existing.closes_at : instant(body.closes_at, "closes_at");
  return { question, detail, options, ...link, closes_at };
}

export function updateRound(store: Store, by: string, id: string, body: Record<string, unknown>): Round {
  const existing = getRound(store, id);
  if (!existing) throw new DeskError(404, "no such vote");
  // Once residents can see a question, its wording and options are fixed. Only the closing date can move.
  if (existing.status !== "draft" && Object.keys(body).some((k) => k !== "closes_at")) throw new DeskError(409, "an opened vote cannot be reworded; only closes_at can change");
  if (existing.status === "closed" || existing.status === "published") throw new DeskError(409, "a closed vote cannot change");
  const input = roundInput(store, body, existing);
  store.append("round.updated", by, `round:${id}`, { fields: Object.keys(body).sort(), closes_at: input.closes_at }, () => {
    store.db
      .prepare("UPDATE rounds SET question = ?, detail = ?, options = ?, about_kind = ?, about_id = ?, closes_at = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(input.question), JSON.stringify(input.detail), JSON.stringify(input.options), input.about_kind, input.about_id, input.closes_at, store.now(), id);
  });
  return getRound(store, id)!;
}

export function getRound(store: Store, id: string): Round | null {
  const row = store.db.prepare("SELECT * FROM rounds WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToRound(row) : null;
}

export function listRounds(store: Store, opts: { status?: string; includeDrafts?: boolean } = {}): Round[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.status) {
    where.push("status = ?");
    args.push(oneOf(opts.status, ROUND_STATUSES, "status"));
  } else if (!opts.includeDrafts) where.push("status != 'draft'");
  const rows = store.db.prepare(`SELECT * FROM rounds ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, id`).all(...args) as Record<string, unknown>[];
  return rows.map(rowToRound);
}

/** draft -> open -> closed -> published. Nothing goes backwards. */
export function moveRound(store: Store, by: string, id: string, to: "open" | "closed" | "published"): Round {
  const r = getRound(store, id);
  if (!r) throw new DeskError(404, "no such vote");
  const allowed: Record<string, RoundStatus> = { open: "draft", closed: "open", published: "closed" };
  if (r.status !== allowed[to]) throw new DeskError(409, `a ${r.status} vote cannot be moved to ${to}`);
  const at = store.now();
  if (to === "open") {
    if (r.closes_at && r.closes_at <= at) throw new DeskError(400, "closes_at is in the past");
    store.append("round.opened", by, `round:${id}`, { opens_at: at, closes_at: r.closes_at }, () => {
      store.db.prepare("UPDATE rounds SET status = 'open', opens_at = ?, updated_at = ? WHERE id = ?").run(at, at, id);
    });
  } else if (to === "closed") {
    const result = tally(store, id);
    store.append("round.closed", by, `round:${id}`, { closed_at: at, result }, () => {
      store.db.prepare("UPDATE rounds SET status = 'closed', closes_at = ?, result = ?, updated_at = ? WHERE id = ?").run(at, JSON.stringify(result), at, id);
    });
  } else {
    store.append("round.published", by, `round:${id}`, { result: r.result }, () => {
      store.db.prepare("UPDATE rounds SET status = 'published', updated_at = ? WHERE id = ?").run(at, id);
    });
  }
  return getRound(store, id)!;
}

/** Every ballot of a round in order, as the auditor sees them: no resident ids, only a stable number per voter. */
export function ballotsOf(store: Store, roundId: string): { voter: number; option: number; seq: number; at: string }[] {
  const rows = store.db.prepare("SELECT resident_id, option, seq, at FROM ballots WHERE round_id = ? ORDER BY seq").all(roundId) as { resident_id: string; option: number; seq: number; at: string }[];
  const voters = new Map<string, number>();
  return rows.map((r) => {
    if (!voters.has(r.resident_id)) voters.set(r.resident_id, voters.size + 1);
    return { voter: voters.get(r.resident_id)!, option: r.option, seq: r.seq, at: r.at };
  });
}

/** The last ballot of each resident counts. The hash covers every ballot, so a recount can be checked. */
export function tally(store: Store, roundId: string): NonNullable<Round["result"]> {
  const r = getRound(store, roundId);
  if (!r) throw new DeskError(404, "no such vote");
  const all = ballotsOf(store, roundId);
  const last = new Map<number, number>();
  for (const b of all) last.set(b.voter, b.option);
  const counts = r.options.map(() => 0);
  for (const option of last.values()) if (counts[option] !== undefined) counts[option]++;
  return {
    counts,
    ballots: all.length,
    voters: last.size,
    tallied_at: store.now(),
    ballots_sha256: sha256(JSON.stringify(all.map((b) => [b.voter, b.option, b.seq]))),
  };
}

/** A resident's ballot. Casting again replaces the earlier one; the earlier one stays on record. */
export function castBallot(store: Store, residentId: string, roundId: string, body: Record<string, unknown>): { option: number; seq: number } {
  const r = getRound(store, roundId);
  if (!r) throw new DeskError(404, "no such vote");
  const now = store.now();
  if (r.status !== "open" || (r.closes_at && r.closes_at <= now)) throw new DeskError(409, "this vote is not open");
  const option = body.option;
  if (!Number.isInteger(option) || (option as number) < 0 || (option as number) >= r.options.length) throw new DeskError(400, `option must be a number from 0 to ${r.options.length - 1}`);
  const seq = ((store.db.prepare("SELECT MAX(seq) AS s FROM ballots WHERE round_id = ?").get(roundId) as { s: number | null }).s ?? 0) + 1;
  const id = newId();
  store.append("round.ballot", `resident:${residentId}`, `round:${roundId}`, { seq }, () => {
    store.db.prepare("INSERT INTO ballots (id, round_id, resident_id, option, seq, at) VALUES (?, ?, ?, ?, ?, ?)").run(id, roundId, residentId, option as number, seq, now);
  });
  return { option: option as number, seq };
}

export function myBallot(store: Store, residentId: string, roundId: string): { option: number; at: string } | null {
  const row = store.db.prepare("SELECT option, at FROM ballots WHERE round_id = ? AND resident_id = ? ORDER BY seq DESC LIMIT 1").get(roundId, residentId) as { option: number; at: string } | undefined;
  return row ?? null;
}

/** Live counts for an open vote are not shown (they would steer late voters); closed ones show the tally. */
export function roundForPublic(store: Store, r: Round): Round & { ballots_so_far: number | null } {
  const n = r.status === "open" ? (store.db.prepare("SELECT COUNT(DISTINCT resident_id) AS n FROM ballots WHERE round_id = ?").get(r.id) as { n: number }).n : null;
  return { ...r, result: r.status === "published" ? r.result : null, ballots_so_far: n };
}

/** Closes every open vote whose closing time has passed. Called on reads and by a timer. */
export function closeDueRounds(store: Store): string[] {
  const now = store.now();
  const due = store.db.prepare("SELECT id FROM rounds WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at <= ?").all(now) as { id: string }[];
  for (const { id } of due) moveRound(store, "system", id, "closed");
  return due.map((d) => d.id);
}
