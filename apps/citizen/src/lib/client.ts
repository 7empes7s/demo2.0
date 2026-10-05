/**
 * The app talks to the Companion through this interface. The served app uses the Companion
 * server (which holds the API key and builds every prompt); the shareable demo runs the same
 * Companion core in the page, with the viewer's own Claude as the model.
 */

import {
  challenge,
  checkClaim,
  explain,
  extractArguments,
  type Argument,
  type ChallengeTurn,
  type ChatMessage,
  type ClaimCheck,
  type Depth,
  type DocketItem,
  type Explanation,
  type Lang,
  type Position,
  type Provider,
  type Source,
} from "@democracy2/companion";

export interface ArgumentSet {
  arguments: Argument[];
  sources: Source[];
}

export interface CompanionClient {
  explain(item: DocketItem, lang: Lang, depth: Depth): Promise<Explanation>;
  arguments(item: DocketItem): Promise<ArgumentSet>;
  challenge(item: DocketItem, lang: Lang, position: Position, history: ChatMessage[]): Promise<ChallengeTurn>;
  claim(item: DocketItem, lang: Lang, claim: string): Promise<ClaimCheck>;
}

export class RemoteClient implements CompanionClient {
  private readonly base: string;
  constructor(base = "") {
    this.base = base;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  explain(item: DocketItem, lang: Lang, depth: Depth) {
    return this.post<Explanation>("explain", { item_id: item.id, lang, depth });
  }
  arguments(item: DocketItem) {
    return this.post<ArgumentSet>("arguments", { item_id: item.id });
  }
  challenge(item: DocketItem, lang: Lang, position: Position, history: ChatMessage[]) {
    return this.post<ChallengeTurn>("challenge", { item_id: item.id, lang, position, history });
  }
  claim(item: DocketItem, lang: Lang, claim: string) {
    return this.post<ClaimCheck>("claim", { item_id: item.id, lang, claim });
  }
}

/** Runs the Companion core in the page. Results are kept for the session, like the server's cache. */
export class LocalClient implements CompanionClient {
  private readonly provider: Provider;
  private readonly memo = new Map<string, Promise<unknown>>();
  constructor(provider: Provider) {
    this.provider = provider;
  }

  private once<T>(key: string, make: () => Promise<T>): Promise<T> {
    if (!this.memo.has(key)) {
      const p = make().catch((e) => {
        this.memo.delete(key);
        throw e;
      });
      this.memo.set(key, p);
    }
    return this.memo.get(key) as Promise<T>;
  }

  explain(item: DocketItem, lang: Lang, depth: Depth) {
    return this.once(`explain:${item.id}:${lang}:${depth}`, () => explain(this.provider, item, { lang, depth }));
  }
  arguments(item: DocketItem) {
    return this.once(`args:${item.id}`, () => extractArguments(this.provider, item));
  }
  async challenge(item: DocketItem, lang: Lang, position: Position, history: ChatMessage[]) {
    const args = await this.arguments(item);
    return challenge(this.provider, item, { lang, position, arguments: args.arguments, sources: args.sources, history });
  }
  claim(item: DocketItem, lang: Lang, claim: string) {
    return checkClaim(this.provider, item, { lang, claim: claim.slice(0, 500) });
  }
}
