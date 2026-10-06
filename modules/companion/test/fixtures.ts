import type { CompletionRequest, Provider } from "../src/provider.ts";
import type { DocketItem } from "../src/types.ts";

/** A synthetic item in the Docket snapshot shape. Not a real bill. */
export const ITEM: DocketItem = {
  id: "lu.chd.0001",
  source: "chd.lu",
  jurisdiction_id: "lu",
  number: "0001",
  type: "bill",
  type_label: "Projet de loi",
  title: { fr: "Projet de loi d'exemple relatif aux pistes cyclables communales" },
  status: "En commission",
  author: "Example Minister",
  committee: "Commission de la Mobilité",
  deposited: "2026-01-15",
  updated: "2026-02-01",
  urls: { fr: "https://example.org/fr/dossier/0001", de: "https://example.org/de/dossier/0001" },
  agenda: [{ meeting_id: "1", date: "2026-02-10", time: "10:00", body: "Commission de la Mobilité", steps: ["Présentation du projet de loi"] }],
  activities: [{ date: "2026-01-15", kind: "Creation", description: "Déposé", actors: ["Example Minister"], documents: [] }],
  documents: [
    {
      label: "Avis de la Chambre d'exemple",
      url: "https://example.org/avis.pdf",
      date: "2026-01-30",
      kind: "avis",
      text: "La Chambre d'exemple estime que le coût de 12 millions d'euros est trop élevé pour les com-\nmunes rurales et demande un financement de l'État.",
    },
    {
      label: "Document de dépôt",
      url: "https://example.org/depot.pdf",
      date: "2026-01-15",
      kind: "depot",
      text: "Le présent projet de loi a pour objet d'obliger chaque commune de plus de 5.000 habitants à créer un réseau cyclable continu d'ici 2030.",
    },
  ],
};

/** Returns canned answers in order and records every request. */
export class FakeProvider implements Provider {
  readonly kind = "fake";
  readonly model = "fake-1";
  readonly requests: CompletionRequest[] = [];
  private readonly answers: string[];
  constructor(answers: string[]) {
    this.answers = answers;
  }
  async complete(req: CompletionRequest): Promise<string> {
    this.requests.push(req);
    const next = this.answers.shift();
    if (next === undefined) throw new Error("no more fake answers");
    return next;
  }
}

/** A synthetic Esch council agenda point in the snapshot/2 shape. Not a real decision. */
export const ESCH_POINT: DocketItem = {
  id: "lu.esch.9001",
  source: "esch.lu",
  jurisdiction_id: "lu-esch",
  number: "3",
  type: "agenda",
  type_label: "Décision",
  title: { fr: "Approbation d'un exemple de convention pour une piste cyclable" },
  status: "Approuvé",
  author: null,
  committee: null,
  deposited: null,
  updated: null,
  urls: { fr: "https://example.org/seance-2026-10-02" },
  agenda: [{ meeting_id: "esch-1", date: "2026-10-02", time: "08:30", body: "Conseil communal d'Esch-sur-Alzette", steps: [] }],
  activities: [],
  documents: [{ label: "Délibération", url: "https://example.org/delib.pdf", kind: "document", sha256: null, fetched_at: null, text: "" }],
  reference: "2026/123",
  theme: "Mobilité",
  votes: {
    counts: { Oui: 11, Non: 8 },
    by_party: { "Parti A": { Oui: 11 }, "Parti B": { Non: 8 } },
    members: [{ name: "Example Councillor", party: "Parti A", vote: "Oui" }],
  },
};

/** A synthetic Esch consultation in the snapshot/2 shape. */
export const ESCH_CONSULTATION: DocketItem = {
  id: "lu.esch.participation.survey.abc",
  source: "esch.lu",
  jurisdiction_id: "lu-esch",
  number: null,
  type: "other",
  type_label: "Enquête",
  title: { fr: "Enquête d'exemple sur les parcs" },
  status: "Actif",
  author: null,
  committee: null,
  deposited: null,
  updated: null,
  urls: { fr: "https://example.org/survey/abc" },
  agenda: [],
  activities: [],
  documents: [],
  summary: "Donnez votre avis sur les parcs.",
  when: "Se termine le 30 octobre 2026",
  opens: "2026-10-01",
  closes: "2026-10-30",
  phases: [],
};
