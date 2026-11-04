# Esch-sur-Alzette "Budget participatif 2026": the form and Democracy2.0's draft answers

> **DRAFT, NOT SUBMITTED.** Nothing in this file has been sent to Esch-sur-Alzette or anyone else.
> It is working material for a decision that has not been taken. The answers in section 4 are
> proposals to review, not commitments. A claim counts as checked only where the "Sources and
> claims" table gives a source for it.

First written 2026-10-15 (PR #73, opened outside the office); landed and reworked 2026-11-04 for
issue #75.

## Open questions for the manager

These need a product decision before anything is submitted. The draft does not decide them.

1. **Submit at all, and as whom.** The form is filed by a person. Box 9 publishes their first and
   last name with the project, and fields 1-7 are their own details. Who files, and is that the
   right public face for the project?
2. **Licence.** The citizen app, the portal, the Companion and Arena are "All rights reserved"
   (their `LICENSE` files). Desk, Agora, Pulse, Provenance and others are AGPL. Answers 18 and 23
   say the code is open, and box 12 promises no exclusive right over the idea. Either open the
   parts Esch-sur-Alzette would run first, or rewrite 18, 23 and the box-12 note to say what is
   held. Which?
3. **Conflict of interest (box 10).** The architecture lists paid offers to communes
   (`docs/architecture/00-overview.md`: "SaaS for municipalities", "B2G SaaS"). Ticking box 10
   says the project brings no direct or indirect financial advantage. State the plans in the form,
   drop them for Esch-sur-Alzette, or do not submit?
4. **Targets in answer 15.** "At least 1,000 enrolled residents" in a year and "every idea and
   every feedback message gets a public answer" are promises. The second one depends on the
   commune's staff, not on us. Keep, change or drop?
5. **A year of unpaid work (answers 21 and 23).** The draft commits the person filing to build,
   run, secure and support the app for a year without pay, and to train staff and run sessions.
   Is that a commitment Democracy2.0 makes?
6. **Budget (answer 22).** About €10,000 is an estimate with no quotes behind it. Approve it as an
   estimate, or get quotes first?
7. **Work asked of the commune (answer 20).** About two hours a week from one staff member, checking
   letter requests against the resident register, a data-protection review and a launch
   announcement. Is it right to ask for this?
8. **Age 14 or more.** The form is for residents aged 14 or more and answer 17 says 14+, but the
   app does not check age. The register check covers residence only. Accept that, or add an age
   step?
9. **What is live.** The live app has no model key (operator queue, Groq entry still open), so
   explanations and file translations are switched off today. The description says files are
   "expliqués simplement". Submit only once the model is on, or reword?

## Sources and claims

Sources:

- **[S1]** A full-page screenshot of the "Add your project" page on Esch-sur-Alzette's
  participation platform (Hoplr, participation.esch.lu), shared by Marouane on 2026-10-15. It is
  not in the repo, and the page has not been read again since. The règlement it links to has
  **not** been read.
- **[S2]** This repo at the commit this file lands in (files named in the table).

| Claim | Source | Status |
|---|---|---|
| Residents aged 14 or more, alone or in a group, may submit a project | S1 | from the screenshot; règlement not read |
| The page showed 442 days remaining on 2026-10-15 | S1 | from the screenshot |
| Fields, required flags and answer types (sections 1-2) | S1 | from the screenshot |
| Data-protection notice: controller, RGPD Art. 6(1)(e) as legal basis, data, recipients, retention, rights, DPO and CNPD addresses | S1 | from the screenshot; not checked against the règlement or the law |
| Vision "Ensemble pour une Ville plus Solidaire" (hint on question 15) | S1 | from the screenshot |
| Foreign residents are more than half of Esch-sur-Alzette's population (answer 17) | none | **unchecked.** No source in the repo; cloud sessions do not browse. Needs a STATEC or commune figure (ask Scout) or must be removed |
| The app is in five languages (lb, fr, de, en, pt) | S2 `apps/citizen/src/lib/i18n.ts` | in the repo |
| It lists Chamber files and Esch-sur-Alzette council points | S2 `apps/citizen/VOCABULARY.md`, `modules/docket/` | in the repo |
| A first version is online | S2 `ops/operator-queue.md` (Done, 2026-10-05) | in the repo |
| Explanations and file translations are off on the live app | S2 `ops/operator-queue.md` (Groq entry open), #61 | in the repo |
| No account; the commune hands out an enrolment code at the desk or by post; no name is kept with the code | S2 `docs/product/desk.md` section 7, `i18n.ts` (`signin_private`, `letter_private`) | in the repo |
| Residents post and support ideas, send feedback with a lookup code, say whether a procedure was carried out, vote on questions the commune opens | S2 `docs/product/desk.md`, `apps/citizen/VOCABULARY.md` | in the repo |
| The portal prints one A4 page per letter | S2 STATE.md (2026-10-09, sign-up by post) | in the repo |
| Which modules are open and which are held | S2 `modules/*/LICENSE`, `apps/*/LICENSE` | in the repo |
| Budget lines (section 4, answer 22) | none | estimate, no quotes |

Checked against the house rules: wording follows `apps/citizen/VOCABULARY.md`, and the French
answers reuse the app's own French words (dossier, idée, soutenir, envoyer un retour, code
d'inscription, procédure, réalisée / à revoir / pas réalisée). On neutrality, the answers describe
a tool the commune uses; they never say what residents should think or vote, and they do not
present the app as replacing the commune or the Chamber (Charter decision of 2026-10-14 in
STATE.md).

## 1. Public part of the form (visible to everyone) [S1]

| # | Field | Required | Notes |
|---|---|---|---|
| a | Title | yes | One line. |
| b | Description | yes | "Décrivez votre projet en quelques phrases (5 à 6 phrases maximum)." |
| c | Location | no | Map pin with an address search. |
| d | Images | no | "Add images". |
| e | Attachments | no | "Add attachments". |

## 2. Extra questions (only the commune sees the answers) [S1]

### Données personnelles

| # | Question | Required | Answer type |
|---|---|---|---|
| 1 | Nom | yes | text |
| 2 | Prénom | yes | text |
| 3 | Téléphone | yes | text |
| 4 | Email | yes | text |
| 5 | Date de naissance (JJ/MM/AAAA) | yes | text |
| 6 | Adresse (Rue + Numéro) | yes | text |
| 7 | Code postal + Localité | yes | text |
| 8 | I was informed how my personal data is processed for the participatory budget (full text at the end of the form) | yes | single box: "Oui, je donne mon accord" |
| 9 | I accept that my first and last name are published when the project is presented and communicated | yes | single box: "Oui" |
| 10 | No conflict of interest: no direct or indirect financial advantage for me, my company, my association or any organisation I am linked to, unless the rules expressly allow it | yes | single box: "Oui" |
| 11 | Submitting creates no right to have it carried out; if it is not carried out I claim no refund or compensation for costs I chose to incur | yes | single box: "Oui" |
| 12 | If the commune carries it out, it may adapt it for technical, legal, budgetary, safety or general-interest reasons; no exclusive right over the idea, subject to intellectual property rights that cannot be waived | yes | single box: "Oui" |
| 13 | I have read the rules (règlement) | yes | single box: "Oui" |
| 14 | The information given is accurate to my knowledge | yes | single box: "Oui" |

Boxes 8-14 are paraphrased in English from the screenshot. The binding wording is the form's own
French and the règlement, which has not been read.

### Projet

| # | Question | Required | Answer type |
|---|---|---|---|
| 15 | But du projet: quels sont les résultats attendus? Hint: link to the vision "Ensemble pour une Ville plus Solidaire" or the theme axes | yes | text |
| 16 | Localisation / Endroit / Adresse du projet | yes | text |
| 17 | Public cible | yes | text |
| 18 | Main d'oeuvre et matériel requis | yes | text |
| 19 | Participation des citoyens ou activité participative: does the project need or allow residents to take part? | yes | Oui / Non |
| 20 | Tâches demandées aux équipes de l'Administration Communale d'Esch-sur-Alzette | no | text |
| 21 | Votre participation à la réalisation du projet | no | text |
| 22 | Budget estimatif, frais de fonctionnement inclus | yes | text |
| 23 | Suivi: maintenance, continuity of the project, by whom and how | yes | text |
| 24 | Illustration du projet: extra files (max 15 MB), illustrations, photos, plans, drawings | no | file upload |

### Protection des données à caractère personnel (notice at the end of the form) [S1]

- Controller: Administration communale de la Ville d'Esch-sur-Alzette, Hôtel de Ville, B.P. 145, L-4002 Esch-sur-Alzette. Purpose: receive, analyse, select, carry out and follow up submitted projects, and communicate with their authors.
- Legal basis: a task carried out in the public interest (RGPD Art. 6(1)(e)), as the notice states.
- Data: name, first name, contact details, postal address and the information in the project and its annexes.
- Recipients: the commune's services and, where needed, persons or contractors the commune authorises to run the participatory budget. Contact details, postal address and date of birth are not published.
- Kept for as long as the project is examined, carried out and followed up, then deleted or archived under the applicable rules.
- Rights: access, rectification, limitation, opposition and, where applicable, erasure. Contact: the commune's data protection officer at the Hôtel de Ville address above (the notice also gives an email). Complaint: CNPD, 15 boulevard du Jazz, L-4370 Belvaux.

## 3. Against Desk's "Post an idea" today [S2]

Desk's idea form (`apps/citizen/src/components/DeskIdeas.svelte`) asks for language, title (140
characters) and text (4000 characters), behind the enrolment code. No name or contact is stored
with an idea, by design (`docs/product/desk.md`).

| Esch-sur-Alzette field | Desk today | Gap |
|---|---|---|
| Title, description | title, text | none |
| Location (map, address) | none | missing |
| Images, attachments, illustration (24) | none | missing |
| Identity and contact (1-7) | enrolment code only; no name kept | deliberate: Desk keeps no name. A handover to the commune would need its own, separate step |
| Consents and declarations (8-14) | none | missing: a required checkbox list, wording from the commune's règlement |
| Project questions (15-23) | free text only | missing: structured questions; 19 is yes/no, 20-21 optional |
| Age 14 or more | not checked | the register check is a person's (as for enrolment letters) |

## 4. Draft answers for Democracy2.0 (cracia) — DRAFT, NOT SUBMITTED

In French, as the form asks. Facts come from this repo (see "Sources and claims"); the budget is an
estimate. Fields 1-7 and boxes 8-14 belong to whoever files (open questions 1-3). Text in
`[à vérifier : …]` has no source yet and must be checked or removed before anything is pasted.

**Titre**

Cracia : suivre, proposer et donner son avis sur la vie d'Esch, au même endroit

**Description** (6 phrases)

Cracia est une application web gratuite, en cinq langues (luxembourgeois, français, allemand,
anglais, portugais), qui rassemble au même endroit les dossiers du conseil communal d'Esch et de
la Chambre des Députés. Chaque semaine, elle montre aux résidents les dossiers qui concernent
l'endroit où ils habitent et les thèmes qu'ils suivent, expliqués simplement, avec un lien vers le
texte officiel. Les résidents peuvent y proposer des idées, soutenir celles des autres, envoyer un
retour à la commune et en suivre la réponse grâce à un code. La commune y publie l'avancement de
ses procédures, étape par étape, et y répond publiquement. Chacun peut participer sans créer de
compte : la commune remet un code d'inscription au guichet ou par courrier, et n'enregistre aucun
nom avec ce code. Une première version fonctionne déjà en ligne ; le budget servirait à la lancer
officiellement à Esch pendant un an.

(Open question 9: "expliqués simplement" is not true on the live app until a model key is set.)

**Localisation :** pas d'épingle ; le projet couvre toute la commune.

**Images :** captures d'écran de Cette semaine, d'une page de dossier, des Idées et d'Envoyer un
retour, sur téléphone et ordinateur (from `citizen-look/` in the project folder).

### Projet

**15. But du projet : quels sont les résultats attendus ?**

Rendre la vie communale lisible et ouverte à tous les résidents, y compris ceux qui ne votent pas
aux élections nationales, en lien avec la vision « Ensemble pour une Ville plus Solidaire ».
Résultats attendus après un an : au moins 1 000 résidents inscrits ; les procédures de la commune
suivies publiquement, étape par étape, avec leurs dates ; chaque idée et chaque retour reçoit une
réponse publique ; un bilan chiffré publié à la fin (participation par quartier et par langue,
délais de réponse), pour décider avec la commune s'il faut continuer.

(Open question 4: the 1,000 target and the public-answer promise.)

**16. Localisation / Endroit / Adresse du projet**

Toute la commune d'Esch-sur-Alzette, en ligne (sur téléphone et ordinateur). Pour les personnes
sans smartphone : demande du code par courrier, et une aide possible au guichet de l'Hôtel de Ville
ou dans les maisons de quartier si la commune le souhaite.

**17. Public cible**

Tous les résidents d'Esch à partir de 14 ans, de tous niveaux numériques, en particulier les
résidents étrangers `[à vérifier : « plus de la moitié de la population », source STATEC ou
commune à citer, sinon supprimer]` et les personnes qui ne lisent pas facilement le français
administratif.

**18. Main d'oeuvre et matériel requis**

L'application existe déjà `[à décider : « et son code est ouvert » n'est vrai que pour une partie
des modules — open question 2]`. Il faut : un serveur hébergé dans l'UE ; l'impression et l'envoi
des lettres avec les codes d'inscription ; une relecture des traductions luxembourgeoise et
portugaise par des locuteurs natifs ; des affiches et dépliants en cinq langues ; deux ou trois
séances de présentation dans les quartiers. Le développement et la maintenance sont faits
bénévolement par le porteur du projet.

**19. Participation des citoyens ou activité participative**

Oui. Le projet est lui-même une activité participative : les résidents proposent des idées,
soutiennent celles des autres, envoient leurs retours, disent si les procédures terminées ont été
réalisées (« réalisée », « à revoir », « pas réalisée ») et votent sur les questions que la commune
ouvre. Des résidents volontaires testent l'application et relisent les traductions.

**20. Tâches demandées aux équipes de l'Administration Communale d'Esch-sur-Alzette**

- Désigner une personne de contact qui publie l'avancement des procédures et répond aux idées et
  aux retours sur le portail de la commune (environ deux heures par semaine).
- Vérifier les demandes de code par courrier dans le registre des résidents, puis envoyer les
  lettres (le portail les imprime, une page A4 par lettre).
- Valider avec le délégué à la protection des données la façon dont les données sont traitées.
- Annoncer le lancement dans les canaux de la Ville.

(Open question 7.)

**21. Votre participation à la réalisation du projet**

Je construis l'application et je m'occupe de l'installation, de la mise à jour, de la sécurité et
du support technique pendant toute la durée du projet, bénévolement. Je forme la personne de
contact de la commune et j'anime les séances de présentation. Je publie le bilan à la fin de
l'année.

(Open question 5.)

**22. Budget estimatif, frais de fonctionnement inclus**

Environ 10 000 € pour un an (estimation, sans devis) :
- Hébergement dans l'UE et sauvegardes, 12 mois : 1 200 €
- Impression et envoi des lettres avec les codes (environ 3 000 lettres) : 3 600 €
- Relecture des traductions (luxembourgeois, portugais) : 1 500 €
- Affiches et dépliants en cinq langues : 1 500 €
- Séances de présentation dans les quartiers (salles, matériel) : 700 €
- Réserve pour imprévus (15 %) : 1 500 €

Aucun montant n'est versé au porteur du projet ; les factures sont payées directement aux
prestataires.

(Open question 6.)

**23. Suivi**

Pendant un an, j'assure la maintenance (mises à jour, sécurité, sauvegardes) et la commune publie
l'avancement de ses procédures. `[à décider : « Le code est ouvert et documenté » — open question
2]` La commune peut à tout moment reprendre l'hébergement elle-même ou le confier à un prestataire,
sans dépendre de moi. À la fin de l'année, un bilan est publié et la commune décide de continuer,
d'adapter ou d'arrêter ; si elle arrête, les données sont exportées pour la commune puis supprimées.

**24. Illustration du projet :** the same screenshots as above plus one A4 enrolment letter (PDF)
from `citizen-look/sign-up/`.

## 5. Before ticking boxes 8-14

These are for whoever files, after the open questions above are settled.

- **Box 9, name published.** Required: ticking it means the filer's first and last name appear
  with the project (open question 1).
- **Box 10, no conflict of interest.** True only if the budget pays nobody connected to the filer
  (the answers say so) and the paid offers to communes are dealt with (open question 3).
- **Box 12, no exclusive right.** Fits the AGPL modules. It does not fit the citizen app, the
  portal, the Companion or Arena while they are "All rights reserved" (open question 2).
- **Box 13, règlement read.** Nobody has read it yet. It must be read before this box is ticked.
