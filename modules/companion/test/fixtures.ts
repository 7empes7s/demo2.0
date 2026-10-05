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
