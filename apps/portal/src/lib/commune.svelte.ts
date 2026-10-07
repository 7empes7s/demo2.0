/** The commune's public settings: its name and the languages it offers. Loaded once; refreshed when an admin saves. */

import { get } from "./api.ts";
import { LANGS, type Lang, type PublicSettings } from "./types.ts";

export const commune = $state<{ name: string; languages: Lang[]; model: boolean }>({ name: "", languages: [...LANGS], model: false });

export async function loadCommune() {
  try {
    const s = await get<PublicSettings>("/settings/public");
    applyCommune(s);
  } catch {
    // The top bar shows no name until the desk answers; nothing else depends on it.
  }
}

export function applyCommune(s: PublicSettings) {
  commune.name = s.commune ?? "";
  const langs = (s.languages ?? []).filter((l): l is Lang => (LANGS as readonly string[]).includes(l));
  commune.languages = langs.length ? langs : [...LANGS];
  commune.model = !!s.ai?.configured;
}
