/**
 * The public list's French text in the resident's language. The server translates it once, in
 * the background, and serves one file with every language to every device
 * (`data/translations.json`), so no request says which language a resident reads or which file
 * they open. A text with no translation yet stays in French. One tap shows the original French
 * everywhere (`showOriginal`); the official documents themselves are never translated.
 */

import type { Lang } from "@democracy2/companion";

import { ui } from "./ui.svelte.ts";

type Texts = Record<string, Partial<Record<Lang, string>>>;

export const translations = $state<{ texts: Texts; original: boolean }>({ texts: {}, original: false });

/** Text the Chamber's page leaves in history rows; the server drops it before translating, as `historyOf` does. */
const PAGE_NOISE = /\s*Bouton graphique servant à afficher ou cacher tous les éléments de la liste qui précède\s*(Voir plus)?\s*(Voir moins)?/gi;
const key = (text: string) => text.replace(PAGE_NOISE, " ").replace(/\s+/g, " ").trim();

/** Reads the translations file. Without one (the shareable demo, an old server, offline with no copy) everything stays in French. */
export async function loadTranslations(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetcher("data/translations.json");
    if (!res.ok) return;
    const raw = (await res.json()) as { schema?: unknown; texts?: unknown };
    if (raw.schema !== "d2.translations/1" || !raw.texts || typeof raw.texts !== "object") return;
    const texts: Texts = {};
    for (const [fr, value] of Object.entries(raw.texts as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row: Partial<Record<Lang, string>> = {};
      for (const [lang, text] of Object.entries(value as Record<string, unknown>)) if (typeof text === "string" && text.trim()) row[lang as Lang] = text;
      texts[key(fr)] = row;
    }
    translations.texts = texts;
  } catch {
    // no translations: the French stays
  }
}

/** The translation of a French text in the resident's language, or null when there is none to show. */
function translated(text: string | null | undefined): string | null {
  if (!text || ui.lang === "fr" || translations.original) return null;
  return translations.texts[key(text)]?.[ui.lang] ?? null;
}

/** What to show for a French text: its translation, or the French itself. */
export function tx(text: string): string;
export function tx(text: string | null | undefined): string | null | undefined;
export function tx(text: string | null | undefined) {
  return translated(text) ?? text;
}

/** The `lang` attribute for what `tx` shows, so screen readers pronounce it right. */
export function langOf(text: string | null | undefined): Lang {
  return translated(text) ? ui.lang : "fr";
}

/** Whether there is anything to switch: the resident reads another language and some text is translated. */
export function canTranslate(): boolean {
  return ui.lang !== "fr" && Object.keys(translations.texts).length > 0;
}

export function toggleOriginal() {
  translations.original = !translations.original;
}
