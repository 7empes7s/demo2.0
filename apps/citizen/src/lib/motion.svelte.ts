/**
 * Motion on or off, chosen by the resident; null follows the device's "reduce motion" setting.
 * Many computers turn animations off by default (Windows "Animation effects", remote desktops),
 * so the choice is in Settings too. The answer is written on <html data-motion="on|off">, and
 * every animation in the app is written for `[data-motion="on"]` only. Kept on this device only.
 */

import { prefs } from "./prefs.ts";

export type Motion = "on" | "off" | null;

export const motion = $state<{ value: Motion }>({ value: prefs.motion() });

function deviceReduces(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Whether the app animates now: the resident's choice, else the device's. */
export function moving(value: Motion = motion.value): boolean {
  return value === "on" || (value === null && !deviceReduces());
}

export function applyMotion(value: Motion = motion.value) {
  document.documentElement.dataset.motion = moving(value) ? "on" : "off";
}

export function setMotion(value: Motion) {
  motion.value = value;
  prefs.setMotion(value);
  applyMotion(value);
}

/** Follow the device when it changes its setting, while the resident has not chosen. */
export function watchMotion(): () => void {
  try {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => applyMotion();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}
