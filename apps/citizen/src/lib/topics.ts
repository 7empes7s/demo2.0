/**
 * Plain-language topic groups over the names the Chamber and the city publish. The public list
 * names a file's topic as a committee ("Commission de la Mobilité et des Travaux publics") or a
 * theme ("Budget et Finances"), in French and in an official register. A resident picks a few
 * groups in their own language instead ("Getting around", "Money and budget"); the group stands
 * for every published name that falls under it, including names the list adds later.
 *
 * A name is sorted into a group by the words in it. A name that matches nothing goes under
 * "Other", so nothing in the public list can be left unfollowable.
 */

import type { Key } from "./i18n.ts";

export const GROUPS = ["money", "housing", "transport", "environment", "family", "health", "work", "safety", "culture", "state", "other"] as const;
export type Group = (typeof GROUPS)[number];

/** The label key of each group, in the five languages of the app. */
export const GROUP_LABEL: Record<Group, Key> = {
  money: "topic_money",
  housing: "topic_housing",
  transport: "topic_transport",
  environment: "topic_environment",
  family: "topic_family",
  health: "topic_health",
  work: "topic_work",
  safety: "topic_safety",
  culture: "topic_culture",
  state: "topic_state",
  other: "topic_other",
};

/** Word starts (lower case, accents removed) that put a published name under a group. */
const WORDS: Record<Exclude<Group, "other">, readonly string[]> = {
  money: ["budget", "finance", "fiscal", "impot", "taxe", "tripartite", "economi", "execution budgetaire"],
  housing: ["logement", "urbain", "urbanisme", "amenagement", "batiment", "patrimoine", "habitat", "construction"],
  transport: ["mobilite", "transport", "circulation", "travaux publics", "route", "velo", "bus", "train"],
  environment: ["environnement", "nature", "climat", "energie", "animaux", "agriculture", "alimentation", "viticulture", "eau", "dechet", "foret"],
  family: ["famille", "enfance", "enfant", "enseignement", "education", "ecole", "accueil", "jeunesse", "egalite", "solidarit", "vivre ensemble", "diversite", "seniors", "aines", "integration"],
  health: ["sante", "securite sociale", "office social", "soins", "hopital", "handicap", "pension"],
  work: ["travail", "emploi", "personnel", "salari", "fonction publique", "classes moyennes", "entreprise", "commerce"],
  safety: ["justice", "securite publique", "police", "affaires interieures", "defense", "pompiers", "secours", "protection des donnees"],
  culture: ["culture", "tourisme", "sport", "loisir", "relations internationales", "jumelage", "medias", "cultes"],
  state: ["reglement", "organisation communale", "democratie", "institution", "constitution", "petition", "affaires etrangeres", "europe", "cooperation", "numerique", "digitalisation", "controle"],
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** The groups a published name falls under: one or more, or "other" when none of its words is known. */
export function groupsOf(topic: string): Group[] {
  const name = fold(topic);
  const found = (Object.keys(WORDS) as Exclude<Group, "other">[]).filter((g) => WORDS[g].some((w) => new RegExp(`\\b${w}`).test(name)));
  return found.length ? found : ["other"];
}

/** The groups present in a list of published names, in the fixed order of `GROUPS`. */
export function groupsIn(topics: readonly string[]): Group[] {
  const present = new Set(topics.flatMap(groupsOf));
  return GROUPS.filter((g) => present.has(g));
}

/** The published names that the chosen groups stand for, out of those in the list. */
export function expandGroups(groups: readonly string[], topics: readonly string[]): string[] {
  const chosen = new Set(groups);
  return topics.filter((t) => groupsOf(t).some((g) => chosen.has(g)));
}

export const isGroup = (value: unknown): value is Group => typeof value === "string" && (GROUPS as readonly string[]).includes(value);
