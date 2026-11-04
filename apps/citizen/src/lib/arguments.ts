/**
 * How a file's arguments (Commons, through the Companion) are sorted for the page: by side for
 * the tabs, reasons apart from council votes, and who said each one in plain words.
 * Nothing here judges an argument: the order is always the one Commons gave.
 */

import type { FileArgument, FileArguments } from "@democracy2/companion";

import type { Key } from "./i18n.ts";

export type Tab = "for" | "against" | "both";
export type Side = "for" | "against" | null;

/** "yes" is for, "no" is against; anything else (a consultation's own option) is neither. */
export const sideOf = (a: FileArgument): Side => (a.stance_option_id === "yes" ? "for" : a.stance_option_id === "no" ? "against" : null);

export interface ArgumentsView {
  /** Whether any argument takes a side: only then are the For · Against · Both tabs shown. */
  sided: boolean;
  counts: Record<Tab, number>;
  /** Reasons people gave, on the chosen side. */
  reasons: FileArgument[];
  /** Whether there are reasons on any side (to tell "none on this side" from "none at all"). */
  anyReasons: boolean;
  /** Ideas residents posted (Commons `proposal`); they take no side, so they show under Both only. */
  ideas: FileArgument[];
  /** Who took a side, never why (Commons `position`), on the chosen side. */
  positions: FileArgument[];
}

export function viewOf(list: FileArguments, tab: Tab): ArgumentsView {
  const all = list.arguments;
  const sided = all.some((a) => sideOf(a) !== null);
  const shown = (a: FileArgument) => !sided || tab === "both" || sideOf(a) === tab;
  const reasons = all.filter((a) => a.kind === "argument");
  return {
    sided,
    counts: { for: all.filter((a) => sideOf(a) === "for").length, against: all.filter((a) => sideOf(a) === "against").length, both: all.length },
    reasons: reasons.filter(shown),
    anyReasons: reasons.length > 0,
    ideas: all.filter((a) => a.kind === "proposal" && shown(a)),
    positions: all.filter((a) => a.kind === "position" && shown(a)),
  };
}

/** Who said it, as a role in the resident's language; `raw` when Commons names them in a way the app does not know. */
export type Role = { key: Key; vars?: Record<string, string> } | { raw: string };

/** Commons names a council group "<group> group, <commune> municipal council". */
const GROUP = /^(.+?) group, .+ (?:municipal|communal) council$/i;
const RESIDENT_PLATFORM = /^a resident, on the city's participation platform$/i;

export function roleOf(a: FileArgument): Role | null {
  const who = a.attribution?.trim();
  if (!who) return null;
  const group = GROUP.exec(who);
  if (group) return { key: "args_role_group", vars: { group: group[1] } };
  if (RESIDENT_PLATFORM.test(who)) return { key: "args_role_resident_platform" };
  return { raw: who };
}

/** A council group's name, for a council vote; null when the attribution is not a group. */
export const groupOf = (a: FileArgument): string | null => GROUP.exec(a.attribution?.trim() ?? "")?.[1] ?? null;

/** How many of the group's councillors voted that way, from Commons' line ("CSV: 6 councillors voted in favour …"). */
export function councillorsOf(a: FileArgument): number | null {
  const m = /\b(\d{1,3}) councillors? voted\b/i.exec(a.text);
  return m ? Number(m[1]) : null;
}

/** Only links a reader can open: http(s), nothing else. */
export function linkOf(a: FileArgument): string | null {
  try {
    const url = new URL(a.source_url ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
