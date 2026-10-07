/** Light or dark, chosen by the resident; null follows the device. Kept on this device only. */

import { prefs } from "./prefs.ts";

export type Theme = "light" | "dark" | null;

export const theme = $state<{ value: Theme }>({ value: prefs.theme() });

export function applyTheme(value: Theme) {
  if (value) document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}

export function setTheme(value: Theme) {
  theme.value = value;
  prefs.setTheme(value);
  applyTheme(value);
}
