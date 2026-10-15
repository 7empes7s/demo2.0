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
