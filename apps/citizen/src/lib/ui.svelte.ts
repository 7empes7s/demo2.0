/** App-wide UI state. Reading `ui.lang` inside `t()` keeps every label reactive to the language. */

import type { Lang } from "@democracy2/companion";

import { formatDate, guessLang, translate, type Key } from "./i18n.ts";
import { prefs } from "./prefs.ts";

const saved = prefs.lang();
const initial: Lang =
  saved === "lb" || saved === "fr" || saved === "de" || saved === "en" || saved === "pt"
    ? saved
    : guessLang(typeof navigator === "undefined" ? [] : navigator.languages);

export const ui = $state<{ lang: Lang }>({ lang: initial });

export function setLang(lang: Lang) {
  ui.lang = lang;
  prefs.setLang(lang);
  document.documentElement.lang = lang;
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  return translate(ui.lang, key, vars);
}

export function date(iso: string | null | undefined): string {
  return formatDate(ui.lang, iso);
}
