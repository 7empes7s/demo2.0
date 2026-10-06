import { describe, expect, it } from "vitest";

import {
  AnthropicProvider,
  endpointHost,
  ModelError,
  OLLAMA_BASE_URL,
  OpenAICompatibleProvider,
  providerFromEnv,
  TEMPERATURE,
} from "../src/provider.ts";

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A fetch that answers from a script and records every call. */
function fakeFetch(script: (() => Response | Error)[]) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) });
    const next = script.shift();
    if (!next) throw new Error("no more scripted answers");
    const out = next();
    if (out instanceof Error) throw out;
    return out;
  };
  return { fetch: f, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completion = (content: unknown) => json(200, { choices: [{ message: { role: "assistant", content } }] });
const REQ = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 500 };

describe("OpenAICompatibleProvider", () => {
  it("posts to {base}/chat/completions with the system message first, a low temperature and JSON mode", async () => {
    const { fetch, calls } = fakeFetch([() => completion('{"a":1}')]);
    const p = new OpenAICompatibleProvider({ baseUrl: "http://127.0.0.1:11434/v1/", apiKey: "k", model: "qwen3:8b", fetch });
    const seen: string[] = [];
    expect(await p.complete({ ...REQ, onText: (t) => seen.push(t) })).toBe('{"a":1}');
    expect(seen).toEqual(['{"a":1}']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("error");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(calls[0].body).toEqual({
      model: "qwen3:8b",
      temperature: TEMPERATURE,
      max_tokens: 500,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
    expect(p.kind).toBe("openai");
    expect(p.model).toBe("qwen3:8b");
  });

  it("sends no Authorization header without a key (local servers) and reads content given as parts", async () => {
    const { fetch, calls } = fakeFetch([() => completion([{ type: "text", text: "{" }, { type: "text", text: "}" }])]);
    const p = new OpenAICompatibleProvider({ baseUrl: "http://localhost:8080/v1", model: "m", fetch });
    expect(await p.complete(REQ)).toBe("{}");
    expect("authorization" in (calls[0].init.headers as Record<string, string>)).toBe(false);
  });

  it("retries 429 and 5xx with Retry-After, up to the cap, then fails with the status", async () => {
    const ok = fakeFetch([
      () => json(429, { error: "slow down" }, { "retry-after": "0" }),
      () => json(503, { error: "busy" }, { "retry-after": "0" }),
      () => completion("{}"),
    ]);
    const p = new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: ok.fetch, retries: 2 });
    expect(await p.complete(REQ)).toBe("{}");
    expect(ok.calls).toHaveLength(3);

    const bad = fakeFetch([() => json(500, "e", { "retry-after": "0" }), () => json(500, "e", { "retry-after": "0" }), () => json(500, "e", { "retry-after": "0" })]);
    const q = new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: bad.fetch, retries: 2 });
    const err = await q.complete(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).status).toBe(500);
    expect(bad.calls).toHaveLength(3);
  });

  it("does not retry a 400 or 401, and reports network errors as ModelError", async () => {
    const unauthorised = fakeFetch([() => json(401, { error: "bad key" })]);
    const p = new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: unauthorised.fetch });
    await expect(p.complete(REQ)).rejects.toMatchObject({ status: 401 });
    expect(unauthorised.calls).toHaveLength(1);

    const down = fakeFetch([() => new TypeError("fetch failed")]);
    const q = new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: down.fetch });
    const err = await q.complete(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as Error).message).toMatch(/unreachable/);
  });

  it("drops JSON mode for good when the server rejects response_format with a 400", async () => {
    const { fetch, calls } = fakeFetch([
      () => json(400, { error: { message: "response_format is not supported" } }),
      () => completion("{}"),
      () => completion("{}"),
    ]);
    const p = new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch });
    expect(await p.complete(REQ)).toBe("{}");
    expect(await p.complete(REQ)).toBe("{}");
    expect(calls.map((c) => "response_format" in c.body)).toEqual([true, false, false]);
  });

  it("fails cleanly when the answer has no choice or is not JSON", async () => {
    const empty = fakeFetch([() => json(200, { choices: [] })]);
    await expect(new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: empty.fetch }).complete(REQ)).rejects.toBeInstanceOf(ModelError);
    const html = fakeFetch([() => new Response("<html>gateway</html>", { status: 200 })]);
    await expect(new OpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: html.fetch }).complete(REQ)).rejects.toBeInstanceOf(ModelError);
  });
});

describe("AnthropicProvider", () => {
  it("posts to /v1/messages with the key header and joins the text blocks", async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { content: [{ type: "text", text: "{" }, { type: "tool_use" }, { type: "text", text: "}" }] })]);
    const p = new AnthropicProvider("k", "model-x", "https://api.example/", { fetch });
    expect(await p.complete(REQ)).toBe("{}");
    expect(calls[0].url).toBe("https://api.example/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(calls[0].body).toMatchObject({ model: "model-x", max_tokens: 500, system: "sys", temperature: TEMPERATURE });
    expect(p.kind).toBe("anthropic");
  });

  it("turns a failed call into a ModelError", async () => {
    const { fetch } = fakeFetch([() => json(400, { error: "bad request" })]);
    await expect(new AnthropicProvider("k", "m", "https://api.example", { fetch }).complete(REQ)).rejects.toBeInstanceOf(ModelError);
  });
});

describe("providerFromEnv", () => {
  it("picks the OpenAI-compatible path when LLM_BASE_URL is set", () => {
    const got = providerFromEnv({ LLM_BASE_URL: "http://127.0.0.1:11434/v1", LLM_MODEL: "qwen3:8b" });
    expect(got?.provider.kind).toBe("openai");
    expect(got?.provider.model).toBe("qwen3:8b");
    expect(got?.endpoint).toBe("http://127.0.0.1:11434");
  });

  it("defaults to Ollama's URL when only LLM_PROVIDER=openai is set, and needs LLM_MODEL", () => {
    const got = providerFromEnv({ LLM_PROVIDER: "openai", LLM_MODEL: "m" });
    expect((got?.provider as OpenAICompatibleProvider).baseUrl).toBe(OLLAMA_BASE_URL);
    expect(() => providerFromEnv({ LLM_PROVIDER: "openai" })).toThrow(/LLM_MODEL/);
    expect(() => providerFromEnv({ LLM_BASE_URL: "ftp://x", LLM_MODEL: "m" })).toThrow(/http/);
  });

  it("keeps the Anthropic path when only ANTHROPIC_API_KEY is set, honouring COMPANION_MODEL then LLM_MODEL", () => {
    const old = providerFromEnv({ ANTHROPIC_API_KEY: "k", COMPANION_MODEL: "old-name" });
    expect(old?.provider.kind).toBe("anthropic");
    expect(old?.provider.model).toBe("old-name");
    expect(old?.endpoint).toBe("https://api.anthropic.com");
    expect(providerFromEnv({ ANTHROPIC_API_KEY: "k", COMPANION_MODEL: "old-name", LLM_MODEL: "new-name" })?.provider.model).toBe("new-name");
    expect(providerFromEnv({ ANTHROPIC_API_KEY: "k" })?.provider.model).toBeTruthy();
    expect(() => providerFromEnv({ LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("prefers LLM_PROVIDER over the guess, returns null with nothing set, and refuses unknown names or timeouts", () => {
    expect(providerFromEnv({ LLM_PROVIDER: "anthropic", LLM_BASE_URL: "http://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m" })?.provider.kind).toBe("anthropic");
    expect(providerFromEnv({})).toBeNull();
    expect(providerFromEnv({ LLM_MODEL: "m" })).toBeNull();
    expect(() => providerFromEnv({ LLM_PROVIDER: "gemini" })).toThrow(/openai or anthropic/);
    expect(() => providerFromEnv({ LLM_BASE_URL: "http://x/v1", LLM_MODEL: "m", LLM_TIMEOUT_MS: "soon" })).toThrow(/LLM_TIMEOUT_MS/);
  });

  it("logs the endpoint as scheme and host only", () => {
    expect(endpointHost("https://openrouter.ai/api/v1?key=secret")).toBe("https://openrouter.ai");
    expect(endpointHost("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(endpointHost("nope")).toBe("(invalid URL)");
  });
});
