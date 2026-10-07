/**
 * The printed enrolment letter: one page per code, in the resident's language. The words match the
 * citizen app's sign-in sheet ("enrolment code", "the commune stores no name with the code"), so a
 * resident reads the same thing on paper and on screen. Printed in the browser; the codes never
 * leave this page.
 */

import type { Lang } from "./types.ts";

const en = {
  title: "Your enrolment code",
  intro: "{commune} invites you to post ideas, support the ideas of other residents, vote on the commune's questions and say whether its work was done.",
  step_open: "Open {site} on your phone or computer.",
  step_code: "The first time you support an idea or vote, the site asks for this code. Type it once; your device remembers it.",
  code: "Your code",
  once: "The code works once and is for you alone. Keep this letter until you have used it.",
  private: "The commune stores no name with the code. Only your device keeps the sign-in.",
  /** Stands in for the commune's name while an admin has not set one. */
  no_commune: "Your commune",
};

export type LetterText = typeof en;

export const LETTERS: Record<Lang, LetterText> = {
  en,
  fr: {
    title: "Votre code d'inscription",
    intro: "{commune} vous invite à proposer des idées, soutenir celles d'autres résidents, voter sur les questions de la commune et dire si son travail a été fait.",
    step_open: "Ouvrez {site} sur votre téléphone ou votre ordinateur.",
    step_code: "La première fois que vous soutenez une idée ou votez, le site vous demande ce code. Tapez-le une fois ; votre appareil s'en souvient.",
    code: "Votre code",
    once: "Le code sert une seule fois et n'est que pour vous. Gardez cette lettre jusqu'à ce que vous l'ayez utilisé.",
    private: "La commune n'enregistre aucun nom avec le code. Seul votre appareil garde la connexion.",
    no_commune: "Votre commune",
  },
  de: {
    title: "Ihr Anmeldecode",
    intro: "{commune} lädt Sie ein, Ideen einzureichen, die Ideen anderer Einwohner zu unterstützen, über die Fragen der Gemeinde abzustimmen und zu sagen, ob ihre Arbeit erledigt wurde.",
    step_open: "Öffnen Sie {site} auf Ihrem Telefon oder Computer.",
    step_code: "Wenn Sie zum ersten Mal eine Idee unterstützen oder abstimmen, fragt die Seite nach diesem Code. Geben Sie ihn einmal ein; Ihr Gerät merkt ihn sich.",
    code: "Ihr Code",
    once: "Der Code gilt einmal und nur für Sie. Bewahren Sie diesen Brief auf, bis Sie ihn benutzt haben.",
    private: "Die Gemeinde speichert keinen Namen zum Code. Nur Ihr Gerät behält die Anmeldung.",
    no_commune: "Ihre Gemeinde",
  },
  lb: {
    title: "Ären Umeldecode",
    intro: "{commune} invitéiert Iech, Iddien anzeginn, d'Iddie vun aneren Awunner z'ënnerstëtzen, iwwer d'Froe vun der Gemeng ofzestëmmen a ze soen, ob hir Aarbecht gemaach gouf.",
    step_open: "Maacht {site} op Ärem Telefon oder Computer op.",
    step_code: "Déi éischte Kéier, wou Dir eng Iddi ënnerstëtzt oder ofstëmmt, freet de Site no dësem Code. Gitt en eng Kéier an; Ären Apparat behält en.",
    code: "Ären Code",
    once: "De Code geet eng Kéier an ass nëmme fir Iech. Behaalt dëse Bréif, bis Dir en benotzt hutt.",
    private: "D'Gemeng späichert keen Numm zum Code. Nëmmen Ären Apparat behält d'Umeldung.",
    no_commune: "Är Gemeng",
  },
  pt: {
    title: "O seu código de inscrição",
    intro: "{commune} convida-o a propor ideias, apoiar as ideias de outros residentes, votar nas perguntas da comuna e dizer se o seu trabalho foi feito.",
    step_open: "Abra {site} no seu telemóvel ou computador.",
    step_code: "Da primeira vez que apoiar uma ideia ou votar, o site pede este código. Escreva-o uma vez; o seu aparelho lembra-se dele.",
    code: "O seu código",
    once: "O código serve uma vez e é só para si. Guarde esta carta até o ter usado.",
    private: "A comuna não guarda nenhum nome com o código. Só o seu aparelho guarda a sessão.",
    no_commune: "A sua comuna",
  },
};

/** The letter's words with the commune's name and the site's address filled in. */
export function letterText(lang: Lang, commune: string, site: string): LetterText {
  const src = LETTERS[lang];
  const name = commune.trim() || src.no_commune;
  const fill = (s: string) => s.replaceAll("{commune}", name).replaceAll("{site}", site);
  return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, fill(v)])) as LetterText;
}

/**
 * Where residents go: the citizen app, which the Companion serves at the root of the same site the
 * portal lives under (`/portal/`). Shown without the scheme, so it reads like an address.
 */
export function siteAddress(href: string): string {
  const root = new URL("../", new URL(".", href));
  return (root.host + root.pathname).replace(/\/$/, "");
}
