/**
 * The one place the Companion talks to a language model. Everything else builds prompts and
 * checks answers, so the model can be swapped (open weights on the operator's own machine, a
 * free tier, a hosted model, in-page) without changes.
 *
 * The default is any OpenAI-compatible chat endpoint (`POST {base}/chat/completions`): Ollama,
 * vLLM, llama.cpp, LM Studio, Groq, OpenRouter, Mistral, Together and the hosted vendors all
 * speak it. No vendor SDK: plain `fetch`, so the operator keeps control of where text goes.
 */

import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import type { ChatMessage } from "./types.ts";

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Called with the whole answer so far while it streams, when the provider can stream. */
  onText?: (textSoFar: string) => void;
  signal?: AbortSignal;
  /** What the call is for ("explain", "challenge", …), kept in the call log. Never resident text. */
  purpose?: string;
}

export interface Provider {
  /** Model identifier, logged with every answer. */
  readonly model: string;
  complete(req: CompletionRequest): Promise<string>;
}

/** How the endpoint answers; both the chat completions and the (older) completions shape. */
interface ChatCompletion {
  choices?: { message?: { content?: string | { type?: string; text?: string }[] | null }; text?: string }[];
  error?: { message?: string } | string;
}

export interface OpenAICompatibleOptions {
  /** Base URL up to and including `/v1` (for example `http://127.0.0.1:11434/v1`). */
  baseUrl: string;
  model: string;
  /** Optional: local servers need none. Sent as `Authorization: Bearer …`. */
  apiKey?: string;
  /** Extra headers some gateways want (OpenRouter's `HTTP-Referer`, for example). */
  headers?: Record<string, string>;
  /** Whole-call deadline in ms (default 120 s: open-weight models on a small box are slow). */
  timeoutMs?: number;
  temperature?: number;
}

/** Any OpenAI-compatible chat endpoint. Server side only when a key is involved. */
export class OpenAICompatibleProvider implements Provider {
  readonly model: string;
  private readonly opts: OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    if (!/^https?:\/\//.test(opts.baseUrl)) throw new Error("AI base URL must start with http:// or https://");
    this.opts = { ...opts, baseUrl: opts.baseUrl.replace(/\/+$/, "") };
    this.model = opts.model;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const signals = [AbortSignal.timeout(this.opts.timeoutMs ?? 120_000)];
    if (req.signal) signals.push(req.signal);
    const headers: Record<string, string> = { "content-type": "application/json", ...(this.opts.headers ?? {}) };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      redirect: "error",
      method: "POST",
      signal: AbortSignal.any(signals),
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 2000,
        temperature: this.opts.temperature ?? 0.2,
        stream: false,
        messages: [{ role: "system", content: req.system }, ...req.messages],
      }),
    });
    if (!res.ok) throw new Error(`model call failed: ${res.status} ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as ChatCompletion;
    if (data.error) throw new Error(`model call failed: ${typeof data.error === "string" ? data.error : data.error.message}`);
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? choice?.text;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((c) => c.type === "text" || c.type === undefined)
              .map((c) => c.text ?? "")
              .join("")
          : "";
    if (!text) throw new Error("model call failed: the answer has no text");
    req.onText?.(text);
    return text;
  }

  /** Lists the models the endpoint offers, for an operator checking a new endpoint. */
  async listModels(): Promise<string[]> {
    const headers: Record<string, string> = { ...(this.opts.headers ?? {}) };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const res = await fetch(`${this.opts.baseUrl}/models`, { redirect: "error", headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`model list failed: ${res.status}`);
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  }
}

/** Calls the Anthropic Messages API directly. Kept for operators who choose a hosted vendor. */
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

/** One line of the model call log: what was asked of which model, never the text itself. */
export interface ModelCall {
  at: string;
  model: string;
  purpose: string;
  /** SHA-256 of the system prompt, so an auditor can tell prompt versions apart. */
  prompt_sha256: string;
  system_chars: number;
  turns: number;
  input_chars: number;
  output_chars: number;
  ms: number;
  ok: boolean;
  error?: string;
}

/**
 * Wraps a provider and keeps a record of every call: the last `keep` in memory (for `/healthz`
 * and an audit view) and, when `file` is set, one JSON line per call appended to that file.
 * The record holds sizes, hashes and timings only. A resident's words never enter it.
 */
export class LoggingProvider implements Provider {
  readonly model: string;
  readonly calls: ModelCall[] = [];
  private readonly inner: Provider;
  private readonly file?: string;
  private readonly keep: number;

  constructor(inner: Provider, opts: { file?: string; keep?: number } = {}) {
    this.inner = inner;
    this.model = inner.model;
    this.file = opts.file;
    this.keep = opts.keep ?? 500;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const started = Date.now();
    const base = {
      at: new Date(started).toISOString(),
      model: this.model,
      purpose: req.purpose ?? "unknown",
      prompt_sha256: createHash("sha256").update(req.system).digest("hex"),
      system_chars: req.system.length,
      turns: req.messages.length,
      input_chars: req.messages.reduce((n, m) => n + m.content.length, 0),
    };
    try {
      const text = await this.inner.complete(req);
      await this.record({ ...base, output_chars: text.length, ms: Date.now() - started, ok: true });
      return text;
    } catch (e) {
      const error = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      await this.record({ ...base, output_chars: 0, ms: Date.now() - started, ok: false, error });
      throw e;
    }
  }

  private async record(call: ModelCall) {
    this.calls.push(call);
    if (this.calls.length > this.keep) this.calls.splice(0, this.calls.length - this.keep);
    if (this.file) {
      try {
        await appendFile(this.file, JSON.stringify(call) + "\n");
      } catch (e) {
        console.warn(`model call log not written: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

/** What the server tells about its model without giving away a key or an address. */
export interface ProviderInfo {
  kind: "openai-compatible" | "anthropic" | "none";
  model: string | null;
}

/**
 * Picks the provider from the environment. `AI_BASE_URL` (with `AI_MODEL`, optional `AI_API_KEY`)
 * selects any OpenAI-compatible endpoint; without it, `ANTHROPIC_API_KEY` selects Anthropic
 * (`COMPANION_MODEL` names the model there). Nothing set: no model, and the server says so.
 */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): { provider: Provider | null; info: ProviderInfo } {
  const baseUrl = env.AI_BASE_URL?.trim();
  if (baseUrl) {
    const model = env.AI_MODEL?.trim();
    if (!model) throw new Error("AI_MODEL must name the model to use at AI_BASE_URL");
    const headers: Record<string, string> = {};
    // AI_HEADERS: "Name: value; Other: value" for gateways that want them (OpenRouter's HTTP-Referer).
    for (const part of (env.AI_HEADERS ?? "").split(";")) {
      const i = part.indexOf(":");
      if (i > 0) headers[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    const timeoutMs = Number(env.AI_TIMEOUT_MS) || undefined;
    return {
      provider: new OpenAICompatibleProvider({ baseUrl, model, apiKey: env.AI_API_KEY?.trim() || undefined, headers, timeoutMs }),
      info: { kind: "openai-compatible", model },
    };
  }
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) {
    const provider = new AnthropicProvider(key, env.COMPANION_MODEL?.trim() || undefined);
    return { provider, info: { kind: "anthropic", model: provider.model } };
  }
  return { provider: null, info: { kind: "none", model: null } };
}
