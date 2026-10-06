import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LoggingProvider, OpenAICompatibleProvider, providerFromEnv } from "../src/provider.ts";
import { FakeProvider } from "./fixtures.ts";

/** A stand-in for any OpenAI-compatible endpoint: records the request, answers what it is told. */
function fakeEndpoint(answer: (body: Record<string, unknown>) => { status?: number; body: unknown }) {
  const seen: { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      seen.push({ path: req.url ?? "", headers: req.headers, body });
      const out = answer(body);
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  return { server, seen };
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}/v1`;
}

describe("OpenAICompatibleProvider", () => {
  it("sends system + turns as chat messages and reads the first choice", async () => {
    const { server, seen } = fakeEndpoint(() => ({ body: { choices: [{ message: { role: "assistant", content: "Bonjour." } }] } }));
    const baseUrl = await listen(server);
    const provider = new OpenAICompatibleProvider({ baseUrl: baseUrl + "/", model: "llama3.2", apiKey: "k-1", headers: { "X-Title": "d2" } });
    const got: string[] = [];
    const text = await provider.complete({ system: "Be brief.", messages: [{ role: "user", content: "Salut" }], maxTokens: 50, onText: (t) => got.push(t) });
    expect(text).toBe("Bonjour.");
    expect(got).toEqual(["Bonjour."]);
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe("/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer k-1");
    expect(seen[0].headers["x-title"]).toBe("d2");
    expect(seen[0].body).toMatchObject({
      model: "llama3.2",
      max_tokens: 50,
      stream: false,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Salut" },
      ],
    });
  });

  it("works without a key and reads content given as parts", async () => {
    const { server, seen } = fakeEndpoint(() => ({ body: { choices: [{ message: { content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] } }] } }));
    const provider = new OpenAICompatibleProvider({ baseUrl: await listen(server), model: "m" });
    expect(await provider.complete({ system: "s", messages: [] })).toBe("AB");
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("fails clearly on an HTTP error, an error body or an empty answer", async () => {
    const { server } = fakeEndpoint((body) =>
      body.model === "missing"
        ? { status: 404, body: { error: { message: "model not found" } } }
        : body.model === "errbody"
          ? { body: { error: { message: "overloaded" } } }
          : { body: { choices: [{ message: { content: "" } }] } },
    );
    const baseUrl = await listen(server);
    await expect(new OpenAICompatibleProvider({ baseUrl, model: "missing" }).complete({ system: "s", messages: [] })).rejects.toThrow(/404/);
    await expect(new OpenAICompatibleProvider({ baseUrl, model: "errbody" }).complete({ system: "s", messages: [] })).rejects.toThrow(/overloaded/);
    await expect(new OpenAICompatibleProvider({ baseUrl, model: "empty" }).complete({ system: "s", messages: [] })).rejects.toThrow(/no text/);
  });

  it("refuses a base URL that is not http(s)", () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: "ftp://x", model: "m" })).toThrow(/http/);
  });

  it("lists the endpoint's models", async () => {
    const { server } = fakeEndpoint(() => ({ body: { data: [{ id: "a" }, { id: "b" }] } }));
    const provider = new OpenAICompatibleProvider({ baseUrl: await listen(server), model: "m" });
    expect(await provider.listModels()).toEqual(["a", "b"]);
  });
});

describe("providerFromEnv", () => {
  it("prefers an OpenAI-compatible endpoint, then Anthropic, then none", () => {
    const open = providerFromEnv({ AI_BASE_URL: "http://127.0.0.1:11434/v1", AI_MODEL: "qwen", ANTHROPIC_API_KEY: "ignored" });
    expect(open.info).toEqual({ kind: "openai-compatible", model: "qwen" });
    expect(open.provider).toBeInstanceOf(OpenAICompatibleProvider);
    const anth = providerFromEnv({ ANTHROPIC_API_KEY: "k", COMPANION_MODEL: "claude-x" });
    expect(anth.info).toEqual({ kind: "anthropic", model: "claude-x" });
    expect(providerFromEnv({})).toEqual({ provider: null, info: { kind: "none", model: null } });
  });

  it("needs a model name with a base URL, and parses extra headers", () => {
    expect(() => providerFromEnv({ AI_BASE_URL: "http://x/v1" })).toThrow(/AI_MODEL/);
    const picked = providerFromEnv({ AI_BASE_URL: "http://x/v1", AI_MODEL: "m", AI_HEADERS: "HTTP-Referer: https://d2.example; X-Title: Civic" });
    expect(picked.provider).toBeInstanceOf(OpenAICompatibleProvider);
  });
});

describe("LoggingProvider", () => {
  it("records sizes, hashes and timing, never the text, in memory and in the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-log-"));
    const file = join(dir, "calls.jsonl");
    const inner = new FakeProvider(["answer one", "answer two"]);
    const provider = new LoggingProvider(inner, { file, keep: 1 });
    expect(provider.model).toBe("fake-1");
    await provider.complete({ system: "SYSTEM", messages: [{ role: "user", content: "secret words" }], purpose: "explain" });
    await provider.complete({ system: "SYSTEM", messages: [{ role: "user", content: "more" }], purpose: "claim" });
    await expect(provider.complete({ system: "S", messages: [] })).rejects.toThrow(/no more/);
    // In memory: only the last `keep` calls.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ ok: false, purpose: "unknown", error: expect.stringMatching(/no more/) });
    const lines = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ model: "fake-1", purpose: "explain", system_chars: 6, turns: 1, input_chars: 12, output_chars: 10, ok: true });
    expect(lines[0].prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[1].purpose).toBe("claim");
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("secret words");
    expect(raw).not.toContain("answer one");
  });
});
