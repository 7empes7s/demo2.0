/**
 * The one place the Companion talks to a language model. Everything else builds prompts and
 * checks answers, so the model can be swapped (hosted, open weights, in-page) without changes.
 */

import type { ChatMessage } from "./types.ts";

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Called with the whole answer so far while it streams, when the provider can stream. */
  onText?: (textSoFar: string) => void;
  signal?: AbortSignal;
}

export interface Provider {
  /** Model identifier, logged with every answer. */
  readonly model: string;
  complete(req: CompletionRequest): Promise<string>;
}

/** Calls the Anthropic Messages API directly. Server side only: it needs the API key. */
export class AnthropicProvider implements Provider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model = "claude-sonnet-5-5", baseUrl = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      redirect: "error",
      method: "POST",
      signal: req.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 2000,
        system: req.system,
        messages: req.messages,
      }),
    });
    if (!res.ok) throw new Error(`model call failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    req.onText?.(text);
    return text;
  }
}
