/** Portal-wide UI state: the language and the theme. Reading `ui.lang` inside `t()` keeps every label reactive. */

import { ApiError } from "./api.ts";
import { guessLang, translate, type Key, type UiLang } from "./i18n.ts";
import { prefs } from "./prefs.ts";
import { formatDate, formatDateTime } from "./text.ts";
import type { Category, FeedbackStatus, IdeaStatus, Lang, ProcedureKind, ProcedureStatus, Role, RoundStatus } from "./types.ts";

const saved = prefs.lang();
const initial: UiLang = saved === "fr" || saved === "en" ? saved : guessLang(typeof navigator === "undefined" ? [] : navigator.languages);

export const ui = $state<{ lang: UiLang; theme: "light" | "dark" | null }>({ lang: initial, theme: prefs.theme() });

export function setLang(lang: UiLang) {
  ui.lang = lang;
  prefs.setLang(lang);
  document.documentElement.lang = lang;
}

export function applyTheme(value: "light" | "dark" | null) {
  if (value) document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}

export function toggleTheme() {
  const current = ui.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  ui.theme = current === "dark" ? "light" : "dark";
  prefs.setTheme(ui.theme);
  applyTheme(ui.theme);
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  return translate(ui.lang, key, vars);
}

export const date = (iso: string | null | undefined) => formatDate(ui.lang, iso);
export const dateTime = (iso: string | null | undefined) => formatDateTime(ui.lang, iso);

/** The sentence a failed call shows: the API's own, except the two cases with a fixed wording. */
export function failure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return t("error_too_many");
    if (e.signedOut) return t("error_signed_out");
    if (e.status === 0) return t("error_network");
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : t("error_network");
}

/* Plain words for Desk's codes. */
export const roleName = (r: Role) => t(`role_${r}`);
export const categoryName = (c: Category) => t(`cat_${c}`);
export const langName = (l: Lang) => t(`lang_${l}`);
export const feedbackStatusName = (s: FeedbackStatus) => t(`status_${s}`);
export const ideaStatusName = (s: IdeaStatus) => t(`idea_status_${s}`);
export const kindName = (k: ProcedureKind) => t(`kind_${k}`);
export const procedureStatusName = (s: ProcedureStatus) => t(`pstatus_${s}`);
export const roundStatusName = (s: RoundStatus) => t(`vote_status_${s}`);
