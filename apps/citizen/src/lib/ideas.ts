/** How the Ideas view words an idea: its text in the reader's language, its age, its support. */

import type { Lang } from "@democracy2/companion";

import type { Key } from "./i18n.ts";

/** When the reader's language is missing, the first of these that the idea has is shown. */
const FALLBACK: readonly Lang[] = ["fr", "de", "lb", "en", "pt"];

/** The text in `lang` if the idea has it, else in the first fallback language it has. */
export function pickText(text: Partial<Record<string, string>>, lang: Lang): { lang: Lang; text: string } | null {
  for (const l of [lang, ...FALLBACK]) {
    const value = text[l];
    if (typeof value === "string" && value) return { lang: l, text: value };
  }
  return null;
}

const DAY = 86_400_000;

/** The age label for an idea posted at `iso`, seen at `now`. Over 60 days, the date instead. */
export function ageOf(iso: string, now: number): { key: Key; n?: number } {
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  if (!(days >= 1)) return { key: "age_today" }; // also a clock a little behind the server's
  if (days === 1) return { key: "age_yesterday" };
  if (days <= 60) return { key: "age_days", n: days };
  return { key: "age_on" };
}

/** French counts 0 and 1 as singular; the other four languages only 1. */
export function supportKey(lang: Lang, n: number): Key {
  return (lang === "fr" ? n <= 1 : n === 1) ? "support_one" : "support_many";
}
