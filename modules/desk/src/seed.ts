/**
 * Loads an example set into an empty store, so a pilot or a demo starts with something on the
 * wall. The shipped seed (`seed/esch.json`) is synthetic: made-up procedures in the shape of
 * Esch-sur-Alzette's real ones, marked as examples in their text. Nothing in it is an official
 * record. A store that already holds a procedure is left alone.
 */

import { randomBytes } from "node:crypto";

import { newId, sha256, Store } from "./db.ts";
import * as desk from "./desk.ts";
import type { Lang } from "./ai.ts";

export interface Seed {
  schema: "d2.desk.seed/1";
  settings?: Record<string, string>;
  procedures?: (Record<string, unknown> & { key?: string; updates?: Record<string, unknown>[] })[];
  ideas?: { lang: Lang; title: string; text: string; supporters?: number; status?: desk.IdeaStatus; answer?: desk.Localized; procedure_key?: string }[];
  feedback?: { lang: Lang; text: string; category?: string; about_procedure_key?: string; answer?: string; publish?: boolean }[];
  rounds?: (Record<string, unknown> & { key?: string; about_procedure_key?: string; state?: "draft" | "open" | "published"; ballots?: number[] })[];
}

/** Makes a resident with no usable token, for seeded ideas, supports and ballots. */
function ghostResident(store: Store): string {
  const id = newId();
  store.db.prepare("INSERT INTO residents (id, token_hash, code_hash, created_at) VALUES (?, ?, ?, ?)").run(id, sha256(randomBytes(32)), sha256(randomBytes(32)), store.now());
  return id;
}

export function loadSeed(store: Store, seed: Seed): boolean {
  if (seed.schema !== "d2.desk.seed/1") throw new Error(`unsupported seed schema ${String(seed.schema)}`);
  const existing = (store.db.prepare("SELECT COUNT(*) AS n FROM procedures").get() as { n: number }).n;
  if (existing > 0) return false;
  const by = "system:seed";
  for (const [k, v] of Object.entries(seed.settings ?? {})) store.setSetting(k, v);
  const procedureIds = new Map<string, string>();
  for (const p of seed.procedures ?? []) {
    const { key, updates, ...rest } = p;
    const created = desk.createProcedure(store, by, rest);
    if (key) procedureIds.set(key, created.id);
    for (const u of updates ?? []) desk.addProcedureUpdate(store, by, created.id, u);
  }
  const ghosts: string[] = [];
  const ghost = (i: number) => {
    while (ghosts.length <= i) ghosts.push(ghostResident(store));
    return ghosts[i];
  };
  for (const [i, idea] of (seed.ideas ?? []).entries()) {
    const author = ghost(i);
    // The hourly limit is per resident; each seeded idea has its own author.
    const created = desk.postIdea(store, author, { lang: idea.lang, title: idea.title, text: idea.text });
    for (let s = 0; s < (idea.supporters ?? 0); s++) desk.support(store, ghost(100 + s), created.id, true);
    if (idea.status && idea.status !== "open") {
      desk.decideIdea(store, by, created.id, { status: idea.status, answer: idea.answer, procedure_id: idea.procedure_key ? procedureIds.get(idea.procedure_key) : undefined });
    }
  }
  for (const f of seed.feedback ?? []) {
    const about = f.about_procedure_key ? { kind: "procedure", id: procedureIds.get(f.about_procedure_key) } : undefined;
    const filed = desk.fileFeedback(store, null, { lang: f.lang, text: f.text, category: f.category, about });
    if (f.answer) desk.answerFeedback(store, by, filed.id, { answer: f.answer, publish: f.publish === true });
  }
  for (const r of seed.rounds ?? []) {
    const { key, about_procedure_key, state, ballots, ...rest } = r;
    const about = about_procedure_key ? { kind: "procedure", id: procedureIds.get(about_procedure_key) } : undefined;
    const created = desk.createRound(store, by, { ...rest, about });
    if (state === "open" || state === "published") {
      desk.moveRound(store, by, created.id, "open");
      (ballots ?? []).forEach((option, i) => desk.castBallot(store, ghost(200 + i), created.id, { option }));
    }
    if (state === "published") {
      desk.moveRound(store, by, created.id, "closed");
      desk.moveRound(store, by, created.id, "published");
    }
    void key;
  }
  return true;
}
