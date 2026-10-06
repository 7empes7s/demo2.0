/**
 * Questions generated from a Docket item by fixed rules, with no model and no network.
 *
 * Each rule asks about one field the file's official page shows (what it is about, how it is
 * classified, the committee, the theme, what is on its agenda, the council vote, its status).
 * The option the text supports is copied from that field and quoted as evidence. The other
 * options are the same field taken from other files in the same snapshot, so every option is
 * real text from an official page, and only one of them belongs to this file.
 * The same item and snapshot always give the same quiz.
 */

import type { LocalizedText, Question, SourceItem } from "./types.ts";

export const RULES_GENERATOR = "arena.rules/1";

const PROMPTS = {
  about: {
    en: "Which of these is this file about?",
    fr: "De quoi traite ce dossier ?",
    de: "Worum geht es in diesem Dossier?",
    lb: "Ëm wat geet et an dësem Dossier?",
    pt: "De que trata este processo?",
  },
  kind: {
    en: "How does the official page classify this file?",
    fr: "Comment la page officielle classe-t-elle ce dossier ?",
    de: "Wie ordnet die offizielle Seite dieses Dossier ein?",
    lb: "Wéi klasséiert déi offiziell Säit dësen Dossier?",
    pt: "Como é que a página oficial classifica este processo?",
  },
  committee: {
    en: "Which committee of the Chamber is handling this file?",
    fr: "Quelle commission de la Chambre s'occupe de ce dossier ?",
    de: "Welcher Ausschuss der Kammer befasst sich mit diesem Dossier?",
    lb: "Wéi eng Kommissioun vun der Chamber beschäftegt sech mat dësem Dossier?",
    pt: "Que comissão da Câmara trata deste processo?",
  },
  theme: {
    en: "Under which theme does the council list this point?",
    fr: "Sous quel thème le conseil classe-t-il ce point ?",
    de: "Unter welchem Thema führt der Gemeinderat diesen Punkt?",
    lb: "Ënner wéi engem Thema féiert de Gemengerot dëse Punkt?",
    pt: "Em que tema é que o conselho coloca este ponto?",
  },
  agenda: {
    en: "Which of these is on the agenda for this file?",
    fr: "Lequel de ces points figure à l'ordre du jour pour ce dossier ?",
    de: "Welcher dieser Punkte steht für dieses Dossier auf der Tagesordnung?",
    lb: "Wéi ee vun dëse Punkte steet fir dësen Dossier um Ordre du jour?",
    pt: "Qual destes pontos está na ordem do dia deste processo?",
  },
  vote: {
    en: "How many council members voted yes on this point?",
    fr: "Combien de membres du conseil ont voté oui sur ce point ?",
    de: "Wie viele Ratsmitglieder haben bei diesem Punkt mit Ja gestimmt?",
    lb: "Wéi vill Memberen vum Gemengerot hu bei dësem Punkt mat Jo gestëmmt?",
    pt: "Quantos membros do conselho votaram sim neste ponto?",
  },
  status: {
    en: "What status does the official page give this file?",
    fr: "Quel statut la page officielle donne-t-elle à ce dossier ?",
    de: "Welchen Stand gibt die offizielle Seite für dieses Dossier an?",
    lb: "Wéi ee Stand gëtt déi offiziell Säit fir dësen Dossier un?",
    pt: "Que estado é que a página oficial indica para este processo?",
  },
} satisfies Record<string, Required<LocalizedText>>;

/** FNV-1a, so distractors are picked the same way on every device and in every test. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s: string) => new Set(fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));

type Close = (a: string, b: string) => boolean;

/** Two titles that share two or more longer words are too close to tell apart fairly. */
const closeTitles: Close = (a, b) => {
  const wa = words(a);
  let shared = 0;
  for (const w of words(b)) if (wa.has(w) && ++shared >= 2) return true;
  return fold(a) === fold(b);
};

/** Agenda steps are short: one shared longer word ("rapporteur") already makes two steps mean the same. */
const closeSteps: Close = (a, b) => {
  const wa = words(a);
  for (const w of words(b)) if (w.length >= 5 && wa.has(w)) return true;
  return fold(a).includes(fold(b)) || fold(b).includes(fold(a));
};

/** The page link for the item, in French first (the language of the source text). */
function pageOf(item: SourceItem): string | undefined {
  const url = item.urls.fr ?? Object.values(item.urls).find(Boolean);
  return url && /^https?:\/\//.test(url) ? url : undefined;
}

const titleOf = (item: SourceItem) => item.title.fr ?? Object.values(item.title).find(Boolean) ?? "";
const titleField = (item: SourceItem) => (item.title.fr ? "title.fr" : `title.${Object.keys(item.title).find((k) => item.title[k as keyof LocalizedText])}`);

/**
 * The part of a title that names the subject: up to the first " ; " (the council writes
 * "subject ; décision"), never cut mid-word, at most 140 characters. Always a substring of the title.
 */
export function titleSnippet(title: string): { quote: string; cut: boolean } {
  const first = title.split(" ; ")[0].trim();
  let quote = first.length >= 25 ? first : title.trim();
  let cut = quote.length < title.trim().length;
  if (quote.length > 140) {
    const at = quote.lastIndexOf(" ", 140);
    quote = quote.slice(0, at > 60 ? at : 140).replace(/[\s,:;]+$/, "");
    cut = true;
  }
  return { quote, cut };
}

/**
 * Up to `n` values from other items, never this item's own, never two alike. `values` comes in
 * groups (files from the same body first); within a group the pick is by hash, so it is fixed.
 */
function distractors(item: SourceItem, groups: string[][], own: string[], n: number, close?: Close): string[] {
  const seen = new Set(own.map(fold));
  const picked: string[] = [];
  for (const values of groups) {
    const pool: string[] = [];
    for (const v of values) {
      const f = fold(v);
      if (!f || seen.has(f)) continue;
      if (close && own.some((o) => close(o, v))) continue;
      seen.add(f);
      pool.push(v);
    }
    pool.sort((a, b) => hash(`${item.id}\0${a}`) - hash(`${item.id}\0${b}`) || a.localeCompare(b));
    for (const v of pool) {
      if (picked.length === n) return picked;
      if (close && picked.some((p) => close(p, v))) continue;
      picked.push(v);
    }
  }
  return picked;
}

const IDS = ["a", "b", "c", "d"];

/** A question whose options are source text in its own language (French on chd.lu and esch.lu). */
function textQuestion(
  id: keyof typeof PROMPTS,
  right: { text: string; field: string; quote: string; url: string },
  wrong: string[],
  lang: keyof LocalizedText = "fr",
): Question | null {
  if (wrong.length < 1) return null;
  const options = [right.text, ...wrong].map((text, i) => ({ id: IDS[i], text: { [lang]: text } as LocalizedText }));
  return { id, origin: "rules", generator: RULES_GENERATOR, prompt: PROMPTS[id], options, answer: "a", evidence: [{ field: right.field, quote: right.quote, url: right.url }] };
}

/** Agenda steps as the page lists them ("- Désignation d'un rapporteur" becomes "Désignation d'un rapporteur"). */
const cleanStep = (s: string) => s.replace(/^[\s\-–•·]+/, "").trim();

const isYes = (key: string) => key.trim().toLowerCase() === "oui";

/** All the questions the rules can ask about this item, in a fixed order. */
export function ruleQuestions(item: SourceItem, all: SourceItem[]): Question[] {
  const url = pageOf(item);
  if (!url) return [];
  const others = all.filter((o) => o.id !== item.id);
  // Files from the same body come first: a council point next to other council points.
  const same = others.filter((o) => o.jurisdiction_id === item.jurisdiction_id);
  const rest = others.filter((o) => o.jurisdiction_id !== item.jurisdiction_id);
  const near = (pick: (o: SourceItem) => string[]) => [same.flatMap(pick), rest.flatMap(pick)];
  const out: (Question | null)[] = [];

  const title = titleOf(item);
  if (title) {
    const { quote, cut } = titleSnippet(title);
    const lang = titleField(item).split(".")[1] as keyof LocalizedText;
    const theirs = near((o) => {
      const s = titleSnippet(titleOf(o));
      return s.quote ? [s.quote + (s.cut ? "…" : "")] : [];
    });
    const wrong = distractors(item, theirs, [quote], 2, closeTitles);
    out.push(textQuestion("about", { text: quote + (cut ? "…" : ""), field: titleField(item), quote, url }, wrong, lang));
  }

  const field = (name: "type_label" | "committee" | "theme" | "status", id: keyof typeof PROMPTS) => {
    const value = item[name]?.trim();
    if (!value || value.startsWith("CHD_")) return;
    const theirs = near((o) => {
      const v = o[name]?.trim();
      return v && !v.startsWith("CHD_") ? [v] : [];
    });
    out.push(textQuestion(id, { text: value, field: name, quote: value, url }, distractors(item, theirs, [value], 2)));
  };

  field("type_label", "kind");
  field("committee", "committee");
  field("theme", "theme");

  // Agenda: one step of this file; the others are steps of other files that this file does not list.
  const own: { text: string; field: string; quote: string }[] = [];
  item.agenda.forEach((m, i) =>
    m.steps.forEach((s, j) => {
      const text = cleanStep(s);
      if (text.length >= 6) own.push({ text, field: `agenda.${i}.steps.${j}`, quote: text });
    }),
  );
  if (own.length) {
    const right = own[0];
    // A step this file's history already mentions is not a wrong answer either.
    const history = item.activities.map((a) => fold(a.description)).filter(Boolean);
    const theirs = near((o) => o.agenda.flatMap((m) => m.steps.map(cleanStep))).map((g) =>
      g.filter((s) => s.length >= 6 && !history.some((h) => h.includes(fold(s)))),
    );
    out.push(textQuestion("agenda", { ...right, url }, distractors(item, theirs, own.map((o) => o.text), 2, closeSteps)));
  }

  // Council vote: how many voted yes. The other options are the other counts and the total.
  const counts = item.votes?.counts ?? {};
  const yesKey = Object.keys(counts).find(isYes);
  if (yesKey && /^[^.\s]+$/.test(yesKey) && Number.isSafeInteger(counts[yesKey])) {
    const yes = counts[yesKey];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const wrong = [...new Set([...Object.entries(counts).filter(([k]) => k !== yesKey).map(([, n]) => n), total])].filter((n) => n !== yes).sort((a, b) => a - b).slice(0, 3);
    if (wrong.length) {
      const number = (n: number): LocalizedText => ({ en: String(n), fr: String(n), de: String(n), lb: String(n), pt: String(n) });
      out.push({
        id: "vote",
        origin: "rules",
        generator: RULES_GENERATOR,
        prompt: PROMPTS.vote,
        options: [yes, ...wrong].map((n, i) => ({ id: IDS[i], text: number(n) })),
        answer: "a",
        evidence: [{ field: `votes.counts.${yesKey}`, quote: String(yes), url }],
      });
    }
  }

  field("status", "status");
  return out.filter((q): q is Question => q !== null);
}

