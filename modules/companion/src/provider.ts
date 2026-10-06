/**
 * The one place the Companion talks to a language model. Everything else builds prompts and
 * checks answers, so the model can be swapped (local, open weights, hosted, in-page) without
 * changes. Two transports, both over plain fetch and no vendor SDK:
 *
 *   OpenAICompatibleProvider  POST {base}/chat/completions, the API that Ollama, vLLM, llama.cpp
 *                             server, LM Studio, Groq, OpenRouter, Mistral and Together speak
 *   AnthropicProvider         POST {base}/v1/messages, kept for the bridge period
 *
 * `providerFromEnv` picks one from LLM_* (or ANTHROPIC_API_KEY) and never logs a key.
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

export type ProviderKind = "openai" | "anthropic" | "fake" | (string & {});

export interface Provider {
  /** Model identifier, logged with every answer. */
  readonly model: string;
  /** Which API the model is reached through; `/healthz` reports it. */
  readonly kind?: ProviderKind;
  complete(req: CompletionRequest): Promise<string>;
}

/**
 * The model could not be reached or did not answer: a network error, a timeout, or a status the
 * retries did not cure. The server turns it into a 502. `message` never holds a key.
 */
export class ModelError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Every answer is asked for at a low temperature: the Companion wants facts, not variety. */
export const TEMPERATURE = 0.2;
/** Default wait for one attempt. Local models on modest hardware are slow, so this is generous. */
export const DEFAULT_TIMEOUT_MS = 120_000;
/** Retries after a 429 or a 5xx (so at most retries + 1 attempts). Nothing else is retried. */
export const DEFAULT_RETRIES = 2;
/** Longest the provider waits between attempts, whatever Retry-After says. */
const MAX_BACKOFF_MS = 10_000;
/** How much of an error body is kept in the message (for logs); never the whole thing. */
const ERROR_BODY_MAX = 300;

interface TransportOptions {
  timeoutMs?: number;
  retries?: number;
  /** Test seam: the fetch to use. */
  fetch?: typeof fetch;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      },
      { once: true },
    );
  });

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  const wanted = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 500 * 2 ** attempt;
  return Math.min(wanted, MAX_BACKOFF_MS);
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_MAX);
}

/**
 * Error text goes to the server log, so it must never carry a credential: an upstream may echo
 * the Authorization header in its error body, and a fetch error may echo the URL. Removes every
 * credential header value we sent and any user:password@ in a URL.
 */
function scrub(text: string, headers: Record<string, string>): string {
  let out = text.replace(/(\/\/)[^/@\s]*@/g, "$1[redacted]@");
  for (const [name, value] of Object.entries(headers)) {
    if (!/^(authorization|x-api-key)$/i.test(name)) continue;
    const secret = value.replace(/^Bearer\s+/i, "");
    if (secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** One attempt's signal: the caller's, plus the attempt timeout. */
function attemptSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

/**
 * Sends one JSON request, retrying on 429 and 5xx (with Retry-After or exponential backoff),
 * and returns the parsed body. Any other status, a network error or a timeout is a ModelError.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: TransportOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "error",
        method: "POST",
        signal: attemptSignal(timeoutMs, signal),
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      const why = e instanceof Error ? e.message : String(e);
      throw new ModelError(`model unreachable: ${scrub(why, headers)}`);
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new ModelError("model answered with a body that is not JSON", res.status);
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const wait = retryAfterMs(res, attempt);
      await res.body?.cancel().catch(() => {});
      await sleep(wait, signal);
      continue;
    }
    throw new ModelError(`model call failed: ${res.status} ${scrub(await errorText(res), headers)}`, res.status);
  }
}

export interface OpenAICompatibleOptions extends TransportOptions {
  /** Base URL up to and including the API version, such as `http://127.0.0.1:11434/v1`. */
  baseUrl: string;
  /** Sent as a Bearer token when set. Local servers need none. */
  apiKey?: string;
  model: string;
  /**
   * Ask for `response_format: {type: "json_object"}` (default on). A server that rejects it with
   * a 400 is asked again without it, and then never again with it.
   */
  jsonMode?: boolean;
}

/** Read `content` from a chat completion: a string, or a list of text parts on some servers. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
      .join("");
  }
  return "";
}

/** Calls any server that speaks the OpenAI chat-completions API. Server side only when a key is set. */
export class OpenAICompatibleProvider implements Provider {
  readonly kind = "openai";
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly transport: TransportOptions;
  private jsonMode: boolean;

  constructor(opts: OpenAICompatibleOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey || undefined;
    this.model = opts.model;
    this.jsonMode = opts.jsonMode ?? true;
    this.transport = { timeoutMs: opts.timeoutMs, retries: opts.retries, fetch: opts.fetch };
  }

  async complete(req: CompletionRequest): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: TEMPERATURE,
      max_tokens: req.maxTokens ?? 2000,
      stream: false,
      messages: [{ role: "system", content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
    };
    if (this.jsonMode) body.response_format = { type: "json_object" };
    let data: unknown;
    try {
      data = await postJson(`${this.baseUrl}/chat/completions`, headers, body, this.transport, req.signal);
    } catch (e) {
      // Some servers and models do not know JSON mode: ask once more as plain text, and remember.
      if (e instanceof ModelError && e.status === 400 && this.jsonMode) {
        this.jsonMode = false;
        delete body.response_format;
        data = await postJson(`${this.baseUrl}/chat/completions`, headers, body, this.transport, req.signal);
      } else {
        throw e;
      }
    }
    const choice = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
    if (!choice) throw new ModelError("model answered without a choice");
    const text = contentText(choice.message?.content);
    req.onText?.(text);
    return text;
  }
}

export interface AnthropicOptions extends TransportOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/** Calls the Anthropic Messages API directly. Server side only: it needs the API key. */
export class AnthropicProvider implements Provider {
  readonly kind = "anthropic";
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly transport: TransportOptions;

  constructor(apiKey: string, model = "claude-sonnet-5-5", baseUrl = "https://api.anthropic.com", transport: TransportOptions = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.transport = transport;
  }

  async complete(req: CompletionRequest): Promise<string> {
    const data = (await postJson(
      `${this.baseUrl}/v1/messages`,
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 2000,
        temperature: TEMPERATURE,
        system: req.system,
        messages: req.messages,
      },
      this.transport,
      req.signal,
    )) as { content?: { type: string; text?: string }[] };
    if (!Array.isArray(data?.content)) throw new ModelError("model answered without content");
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    req.onText?.(text);
    return text;
  }
}

/** The Ollama server's default OpenAI-compatible base URL, used when LLM_PROVIDER=openai names no other. */
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export interface ProviderEnv {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  ANTHROPIC_API_KEY?: string;
  /** Older name for the Anthropic model; LLM_MODEL wins when both are set. */
  COMPANION_MODEL?: string;
}

/** A provider's endpoint as it may be logged: scheme and host only, never the path or a key. */
export function endpointHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid URL)";
  }
}

/**
 * A base URL is scheme, host and path only. A key belongs in LLM_API_KEY: one written into the
 * URL (user:password@ or ?key=) would be sent to every log line that names the endpoint.
 */
function checkBaseUrl(baseUrl: string): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error("LLM_BASE_URL must be an http(s) URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("LLM_BASE_URL must be an http(s) URL");
  if (u.username || u.password || u.search || u.hash) {
    throw new Error("LLM_BASE_URL must not carry credentials, a query or a fragment; put the key in LLM_API_KEY");
  }
}

/**
 * Builds the provider the environment asks for, or null when it asks for none (the server then
 * serves the app and data and answers 503 on the model routes).
 *
 *   LLM_PROVIDER      openai | anthropic. Default: openai when LLM_BASE_URL is set, anthropic
 *                     when only ANTHROPIC_API_KEY is, none otherwise.
 *   LLM_BASE_URL      openai: base URL up to the version (default OLLAMA_BASE_URL)
 *   LLM_API_KEY       openai: optional Bearer token
 *   LLM_MODEL         openai: required; anthropic: optional (then COMPANION_MODEL, then the default)
 *   LLM_TIMEOUT_MS    one attempt's wait (default 120000)
 *
 * Throws on a configuration the operator must fix (unknown provider, missing model or key).
 */
export function providerFromEnv(env: ProviderEnv): { provider: Provider; endpoint: string } | null {
  const kind = env.LLM_PROVIDER?.trim().toLowerCase() || (env.LLM_BASE_URL ? "openai" : env.ANTHROPIC_API_KEY ? "anthropic" : "");
  if (!kind) return null;
  const timeoutMs = env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : undefined;
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new Error("LLM_TIMEOUT_MS must be a positive number of milliseconds");
  if (kind === "openai") {
    const baseUrl = env.LLM_BASE_URL?.trim() || OLLAMA_BASE_URL;
    checkBaseUrl(baseUrl);
    const model = env.LLM_MODEL?.trim();
    if (!model) throw new Error("LLM_MODEL is required with LLM_PROVIDER=openai (for example qwen3:8b)");
    return { provider: new OpenAICompatibleProvider({ baseUrl, apiKey: env.LLM_API_KEY, model, timeoutMs }), endpoint: endpointHost(baseUrl) };
  }
  if (kind === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY?.trim() || env.LLM_API_KEY?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY (or LLM_API_KEY) is required with LLM_PROVIDER=anthropic");
    const model = env.LLM_MODEL?.trim() || env.COMPANION_MODEL?.trim() || undefined;
    const baseUrl = env.LLM_BASE_URL?.trim() || undefined;
    if (baseUrl) checkBaseUrl(baseUrl);
    return { provider: new AnthropicProvider(apiKey, model, baseUrl, { timeoutMs }), endpoint: endpointHost(baseUrl ?? "https://api.anthropic.com") };
  }
  throw new Error(`LLM_PROVIDER must be openai or anthropic, not "${kind}"`);
}
