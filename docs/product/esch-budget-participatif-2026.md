# Esch's "Budget participatif 2026" submission form, against Desk ideas (reference, 2026-10-15)

Source: a full-page screenshot Marouane shared on 2026-10-15 of the "Add your project" page on Esch's participation platform (Hoplr, participation.esch.lu). Transcribed as data, field for field; wording kept in the original French.

Context on the page: residents of the Ville d'Esch-sur-Alzette aged 14 or more, alone or in a group, can submit a project for the town's 2026 participatory budget. The page showed 442 days remaining.

## 1. Public part (visible to everyone)

| # | Field | Required | Notes |
|---|---|---|---|
| a | Title | yes | One line. |
| b | Description | yes | "Décrivez votre projet en quelques phrases (5 à 6 phrases maximum)." |
| c | Location | no | Map pin with an address search. |
| d | Images | no | "Add images". |
| e | Attachments | no | "Add attachments". |

## 2. Extra questions (only the town sees the answers)

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
| 12 | If the town carries it out, it may adapt it for technical, legal, budgetary, safety or general-interest reasons; no exclusive right over the idea, subject to intellectual property rights that cannot be waived | yes | single box: "Oui" |
| 13 | I have read the rules (règlement) | yes | single box: "Oui" |
| 14 | The information given is accurate to my knowledge | yes | single box: "Oui" |

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

### Protection des données à caractère personnel (notice at the end)

- Controller: Administration communale de la Ville d'Esch-sur-Alzette, Hôtel de Ville, B.P. 145, L-4002 Esch-sur-Alzette. Purpose: receive, analyse, select, carry out and follow up submitted projects, and communicate with their authors.
- Legal basis: a task carried out in the public interest (RGPD Art. 6(1)(e)).
- Data: name, first name, contact details, postal address and the information in the project and its annexes.
- Recipients: the town's services and, where needed, persons or contractors the town authorises to run the participatory budget. Contact details, postal address and date of birth are not published.
- Kept for as long as the project is examined, carried out and followed up, then deleted or archived under the applicable rules.
- Rights: access, rectification, limitation, opposition and, where applicable, erasure. Contact: Délégué à la protection des données, Hôtel de Ville, B.P. 145, L-4002 Esch-sur-Alzette, dpo@villeesch.lu. Complaint: CNPD, 15 boulevard du Jazz, L-4370 Belvaux.

## 3. Against Desk's "Post an idea" today

Desk's idea form (`apps/citizen/src/components/DeskIdeas.svelte`) asks for language, title (140 characters) and text (4000 characters), behind the enrolment code. No name or contact is stored with an idea, by design (`docs/product/desk.md`).

| Esch field | Desk today | Gap |
|---|---|---|
| Title, description | title, text | none |
| Location (map, address) | none | missing |
| Images, attachments, illustration (24) | none | missing |
| Identity and contact (1-7) | enrolment code only; no name kept | deliberate: Desk keeps no name. A handover to the town would need its own, separate step |
| Consents and declarations (8-14) | none | missing: a required checkbox list, wording from the town's règlement |
| Project questions (15-23) | free text only | missing: structured questions; 19 is yes/no, 20-21 optional |
| Age 14 or more | not checked | the register check is a person's (as for enrolment letters) |

## 4. Draft answers for Democracy2.0 (cracia), to paste

In French, as the form asks. Facts come from this repo as of 2026-10-15; the budget is an estimate to adjust. Fields 1-7 and the boxes 8-14 are Marouane's own (see section 5).

**Title**

Cracia : suivre, proposer et donner son avis sur la vie d'Esch, au même endroit

**Description** (6 phrases)

Cracia est une application web gratuite, en cinq langues (luxembourgeois, français, allemand, anglais, portugais), qui rassemble au même endroit ce que la Ville et la Chambre décident pour Esch. Chaque semaine, elle montre aux résidents les dossiers qui concernent leur quartier et leurs sujets, expliqués simplement, avec un lien vers le texte officiel. Les résidents peuvent y proposer des idées, soutenir celles des autres, envoyer une remarque à la commune et suivre la réponse grâce à un code. La commune y publie l'avancement de ses projets, étape par étape, et répond publiquement. Chacun peut participer sans créer de compte : la commune remet un code personnel par courrier, et aucun nom n'est conservé à côté des avis ou des idées. Une première version fonctionne déjà en ligne ; le budget servirait à la lancer officiellement à Esch pendant un an.

**Location:** no pin; the project covers the whole commune.

**Images:** screenshots of This week, a file page, Ideas and Send feedback, phone and desktop (from `citizen-look/` in the project folder).

### Projet

**15. But du projet : quels sont les résultats attendus ?**

Rendre la vie communale lisible et ouverte à tous les résidents, y compris ceux qui ne votent pas aux élections nationales, en lien avec la vision « Ensemble pour une Ville plus Solidaire ». Résultats attendus après un an : au moins 1 000 résidents inscrits ; les projets de la commune suivis publiquement, étape par étape, avec leurs dates ; chaque idée et chaque remarque reçoit une réponse publique ; un bilan chiffré publié à la fin (participation par quartier et par langue, délais de réponse), pour décider avec la commune s'il faut continuer.

**16. Localisation / Endroit / Adresse du projet**

Toute la commune d'Esch-sur-Alzette, en ligne (sur téléphone et ordinateur). Pour les personnes sans smartphone : demande du code par courrier, et une aide possible au guichet de l'Hôtel de Ville ou dans les maisons de quartier si la commune le souhaite.

**17. Public cible**

Tous les résidents d'Esch à partir de 14 ans, de tous âges et de tous niveaux numériques, en particulier les résidents étrangers (plus de la moitié de la population) et les personnes qui ne lisent pas facilement le français administratif.

**18. Main d'oeuvre et matériel requis**

L'application existe déjà et son code est ouvert. Il faut : un serveur hébergé dans l'UE ; l'impression et l'envoi des lettres avec les codes personnels ; une relecture des traductions luxembourgeoise et portugaise par des locuteurs natifs ; des affiches et dépliants en cinq langues ; deux ou trois séances de présentation dans les quartiers. Le développement et la maintenance sont faits bénévolement par le porteur du projet.

**19. Participation des citoyens ou activité participative**

Oui. Le projet est lui-même une activité participative : les résidents proposent des idées, soutiennent celles des autres, envoient leurs remarques, donnent leur avis sur les projets terminés (« fait », « à revoir », « pas fait ») et répondent aux consultations ouvertes par la commune. Des résidents volontaires testent l'application et relisent les traductions.

**20. Tâches demandées aux équipes de l'Administration Communale d'Esch-sur-Alzette**

- Désigner une personne de contact qui publie l'avancement des projets et répond aux idées et remarques sur le portail de la commune (environ deux heures par semaine).
- Vérifier les demandes de code par courrier dans le registre des résidents, puis envoyer les lettres (le portail les imprime, une page A4 par lettre).
- Valider avec le délégué à la protection des données la façon dont les données sont traitées.
- Annoncer le lancement dans les canaux de la Ville.

**21. Votre participation à la réalisation du projet**

Je construis l'application et je m'occupe de l'installation, de la mise à jour, de la sécurité et du support technique pendant toute la durée du projet, bénévolement. Je forme la personne de contact de la commune et j'anime les séances de présentation. Je publie le bilan à la fin de l'année.

**22. Budget estimatif, frais de fonctionnement inclus**

Environ 10 000 € pour un an :
- Hébergement dans l'UE et sauvegardes, 12 mois : 1 200 €
- Impression et envoi des lettres avec les codes (environ 3 000 lettres) : 3 600 €
- Relecture des traductions (luxembourgeois, portugais) : 1 500 €
- Affiches et dépliants en cinq langues : 1 500 €
- Séances de présentation dans les quartiers (salles, matériel) : 700 €
- Réserve pour imprévus (15 %) : 1 500 €

Aucun montant n'est versé au porteur du projet ; les factures sont payées directement aux prestataires.

**23. Suivi**

Pendant un an, j'assure la maintenance (mises à jour, sécurité, sauvegardes) et la commune publie l'avancement des projets. Le code est ouvert et documenté : la commune peut à tout moment reprendre l'hébergement elle-même ou le confier à un prestataire, sans dépendre de moi. À la fin de l'année, un bilan est publié et la commune décide de continuer, d'adapter ou d'arrêter ; si elle arrête, les données sont exportées pour la commune puis supprimées.

**24. Illustration du projet:** the same screenshots as above plus one A4 enrolment letter (PDF) from `citizen-look/sign-up/`.

## 5. Before ticking boxes 8-14 (Marouane's call)

- **Box 10, no conflict of interest.** Ticking it is only true if the budget pays nobody connected to Marouane. The answers above say so (hosting, printing and proofreading paid to third parties, no pay for him). Two things still read as an advantage: the architecture plans paid offers to communes (`docs/architecture/00-overview.md`, e.g. "SaaS for municipalities"), and the Companion and Arena modules are "All rights reserved", not open. Either state this in the form, or put the parts Esch would run under an open licence first.
- **Box 12, no exclusive right.** Fits the AGPL modules. It does not fit Companion and Arena while they are "All rights reserved", and the citizen app relies on the Companion.
- **Box 9, name published.** Required: ticking it means Marouane's first and last name appear with the project.
- **Age 14 or more.** "Public cible" says 14+, but the app does not check age today; the commune's register check covers residence, not age.
