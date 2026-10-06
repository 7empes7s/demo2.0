/**
 * Two checks on a quiz, both fail closed:
 * - `quizProblems`: the shape of spec/schemas/quiz.schema.json, plus what JSON Schema cannot say
 *   (the answer names one of the options, ids are unique, no two options read the same).
 * - `groundingProblems`: every quote is found word for word in the field it names on the Docket
 *   item, and every link is one the item itself publishes.
 * A question that fails either is never shown.
 */

import { LANGS, type Evidence, type Question, type Quiz, type SourceItem } from "./types.ts";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const FIELD = /^[^.\s]+(\.[^.\s]+)*$/;
const GENERATOR = /^[a-z0-9.-]+\/[0-9]+$/;

function only(obj: Record<string, unknown>, keys: string[], at: string, out: string[]) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out.push(`${at}.${k}: not allowed`);
}

function localizedProblems(v: unknown, at: string, out: string[]) {
  if (!isObject(v)) return void out.push(`${at}: expected an object of languages`);
  const keys = Object.keys(v);
  if (!keys.length) out.push(`${at}: needs at least one language`);
  for (const k of keys) {
    if (!(LANGS as readonly string[]).includes(k)) out.push(`${at}.${k}: not one of ${LANGS.join(", ")}`);
    else if (!isText(v[k])) out.push(`${at}.${k}: expected text`);
  }
}

export function isWebUrl(s: unknown): s is string {
  if (typeof s !== "string" || !/^https?:\/\/[^\s]+$/.test(s)) return false;
  try {
    return !!new URL(s).host;
  } catch {
    return false;
  }
}

function evidenceProblems(v: unknown, at: string, out: string[]) {
  if (!isObject(v)) return void out.push(`${at}: expected an object`);
  only(v, ["field", "quote", "url"], at, out);
  if (!isText(v.field) || !FIELD.test(v.field)) out.push(`${at}.field: expected a dotted path`);
  if (!isText(v.quote)) out.push(`${at}.quote: expected text`);
  if (!isWebUrl(v.url)) out.push(`${at}.url: expected an http(s) link`);
}

function checkQuestion(v: unknown, at: string, out: string[]) {
  if (!isObject(v)) return void out.push(`${at}: expected an object`);
  only(v, ["id", "origin", "generator", "prompt", "options", "answer", "evidence"], at, out);
  if (!isText(v.id)) out.push(`${at}.id: expected text`);
  if (v.origin !== "seed" && v.origin !== "rules") out.push(`${at}.origin: not one of seed, rules`);
  if (!isText(v.generator) || !GENERATOR.test(v.generator)) out.push(`${at}.generator: expected name/version`);
  localizedProblems(v.prompt, `${at}.prompt`, out);
  const options = v.options;
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
    out.push(`${at}.options: expected 2 to 4 options`);
  } else {
    const ids = new Set<string>();
    const texts = new Set<string>();
    options.forEach((o, i) => {
      const oat = `${at}.options[${i}]`;
      if (!isObject(o)) return void out.push(`${oat}: expected an object`);
      only(o, ["id", "text"], oat, out);
      if (!isText(o.id)) out.push(`${oat}.id: expected text`);
      else if (ids.has(o.id)) out.push(`${oat}.id: repeated`);
      else ids.add(o.id);
      localizedProblems(o.text, `${oat}.text`, out);
      if (isObject(o.text)) {
        // Two options that read the same in any language would make the question unanswerable.
        for (const [lang, text] of Object.entries(o.text)) {
          const key = `${lang}\0${String(text).trim().toLowerCase()}`;
          if (texts.has(key)) out.push(`${oat}.text.${lang}: same as another option`);
          texts.add(key);
        }
      }
    });
    if (!isText(v.answer) || !ids.has(v.answer)) out.push(`${at}.answer: must name one of the options`);
  }
  if (!Array.isArray(v.evidence) || v.evidence.length < 1 || v.evidence.length > 3) {
    out.push(`${at}.evidence: expected 1 to 3 quoted passages`);
  } else {
    v.evidence.forEach((e, i) => evidenceProblems(e, `${at}.evidence[${i}]`, out));
  }
}

/** Why `value` is not a well-formed question; empty when it is. */
export function questionProblems(value: unknown, at = "question"): string[] {
  const out: string[] = [];
  checkQuestion(value, at, out);
  return out;
}

/** Why `value` is not a well-formed quiz; empty when it is. */
export function quizProblems(value: unknown): string[] {
  const out: string[] = [];
  if (!isObject(value)) return ["quiz: expected an object"];
  only(value, ["id", "item_id", "questions"], "quiz", out);
  if (!isText(value.id)) out.push("quiz.id: expected text");
  if (!isText(value.item_id)) out.push("quiz.item_id: expected text");
  const qs = value.questions;
  if (!Array.isArray(qs) || qs.length < 3 || qs.length > 5) {
    out.push("quiz.questions: expected 3 to 5 questions");
  }
  if (Array.isArray(qs)) {
    const ids = new Set<string>();
    qs.forEach((q, i) => {
      checkQuestion(q, `quiz.questions[${i}]`, out);
      if (isObject(q) && isText(q.id)) {
        if (ids.has(q.id)) out.push(`quiz.questions[${i}].id: repeated`);
        ids.add(q.id);
      }
    });
  }
  return out;
}

/** The value at a dotted path, own properties only; undefined when any step is missing. */
export function fieldValue(item: unknown, field: string): unknown {
  let at: unknown = item;
  for (const step of field.split(".")) {
    if (Array.isArray(at)) {
      if (!/^(0|[1-9][0-9]*)$/.test(step)) return undefined;
      at = at[Number(step)];
    } else if (isObject(at) && Object.hasOwn(at, step)) {
      at = at[step];
    } else {
      return undefined;
    }
  }
  return at;
}

/** Every web link the item publishes: its official pages, its documents and the documents in its history. */
export function linksOf(item: SourceItem): Set<string> {
  const links = new Set<string>();
  for (const url of Object.values(item.urls ?? {})) if (url) links.add(url);
  for (const d of item.documents ?? []) links.add(d.url);
  for (const a of item.activities ?? []) for (const d of a.documents ?? []) links.add(d.url);
  return links;
}

/** Why one passage is not grounded in the item; empty when the quote is in the field and the link is the item's. */
export function evidenceGroundingProblems(item: SourceItem, e: Evidence, at = "evidence"): string[] {
  const out: string[] = [];
  const value = fieldValue(item, e.field);
  const missing = `${at}: quote not found word for word in ${e.field}`;
  if (typeof value === "string") {
    if (!value.includes(e.quote)) out.push(missing);
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    // A number must be quoted whole: "1" is not a quote of 11.
    if (String(value) !== e.quote) out.push(missing);
  } else {
    out.push(`${at}: ${e.field} is not a text or whole-number field of the item`);
  }
  if (!linksOf(item).has(e.url)) out.push(`${at}: link is not one the item publishes`);
  return out;
}

export function questionGroundingProblems(item: SourceItem, q: Question, at = "question"): string[] {
  return q.evidence.flatMap((e, i) => evidenceGroundingProblems(item, e, `${at}.evidence[${i}]`));
}

/** Why the quiz is not grounded in this item; empty when every quote and link checks out. */
export function groundingProblems(quiz: Quiz, item: SourceItem): string[] {
  const out: string[] = [];
  if (quiz.item_id !== item.id) out.push(`quiz.item_id: ${quiz.item_id} is not this item`);
  quiz.questions.forEach((q, i) => out.push(...questionGroundingProblems(item, q, `quiz.questions[${i}]`)));
  return out;
}
