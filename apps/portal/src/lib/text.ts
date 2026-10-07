/** Reading text that comes in several languages, and formatting dates for the signed-in person. */

import { LANGS, type Lang, type Localized } from "./types.ts";

const FALLBACK: Lang[] = ["fr", "en", "de", "lb", "pt"];

/** The text in the reader's language, or the first language that has it. */
export function pick(loc: Localized | null | undefined, lang: Lang): { text: string; lang: Lang | null } {
  if (!loc) return { text: "", lang: null };
  if (loc[lang]) return { text: loc[lang] as string, lang };
  for (const l of FALLBACK) if (loc[l]) return { text: loc[l] as string, lang: l };
  return { text: "", lang: null };
}

export function langsOf(loc: Localized | null | undefined): Lang[] {
  if (!loc) return [];
  return LANGS.filter((l) => !!loc[l]);
}

/** Drops empty languages so Desk never receives "" for a language. */
export function compact(loc: Localized): Localized {
  const out: Localized = {};
  for (const l of LANGS) {
    const v = (loc[l] ?? "").trim();
    if (v) out[l] = v;
  }
  return out;
}

const LOCALES: Record<"fr" | "en", string> = { fr: "fr-LU", en: "en-GB" };

export function formatDate(lang: "fr" | "en", iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Luxembourg" }).format(d);
  } catch {
    return iso;
  }
}

export function formatDateTime(lang: "fr" | "en", iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Luxembourg" }).format(d);
  } catch {
    return iso;
  }
}

/** An ISO instant as the value of a datetime-local input (local time of this device). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The short form of a hash for a row: the first characters, never the whole. */
export function short(hash: string | null | undefined, n = 10): string {
  return (hash ?? "").slice(0, n);
}

/** "staff:abc" -> ("staff", "abc"); "anonymous" -> ("anonymous", ""). */
export function splitRef(ref: string): { kind: string; id: string } {
  const i = ref.indexOf(":");
  return i < 0 ? { kind: ref, id: "" } : { kind: ref.slice(0, i), id: ref.slice(i + 1) };
}
