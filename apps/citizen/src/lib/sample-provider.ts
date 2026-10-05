/**
 * A Companion provider backed by the claude.ai artifact `sample` capability, so the shareable
 * demo needs no server and no API key: the viewer's own Claude answers, after they consent.
 */

import type { CompletionRequest, Provider } from "@democracy2/companion";

import { CompanionFailure } from "./errors.ts";

type Turn = { role: "user" | "assistant"; content: string };
export type SampleFn = (
  input: Turn[],
  opts?: { onText?: (p: { text: string }) => void; signal?: AbortSignal; cache?: boolean; modelTier?: string },
) => Promise<{ text: string; truncated?: boolean }>;

export class SampleProvider implements Provider {
  readonly model = "claude.ai sample";
  private readonly sample: SampleFn;
  constructor(sample: SampleFn) {
    this.sample = sample;
  }

  async complete(req: CompletionRequest): Promise<string> {
    // `sample` has no system slot: the instructions lead the first user turn instead.
    const [first, ...rest] = req.messages;
    const turns: Turn[] = [
      { role: "user", content: `<instructions>\n${req.system}\n</instructions>\n\n${first?.content ?? ""}` },
      ...rest,
    ];
    let out: { text: string; truncated?: boolean };
    try {
      out = await this.sample(turns, {
        signal: req.signal,
        // The app keeps its own results; replaying a cached answer would only repeat a failure.
        cache: false,
        onText: req.onText ? ({ text }) => req.onText?.(text) : undefined,
      });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "not_granted") throw new CompanionFailure("unavailable");
      if (code === "rate_limited") throw new CompanionFailure("busy");
      throw error;
    }
    if (out.truncated) throw new CompanionFailure("too_long");
    return out.text;
  }
}

interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

/** The viewer's Claude when this page runs as a claude.ai artifact, otherwise null. */
export async function findSample(): Promise<SampleFn | null> {
  const host = (globalThis as { claude?: ClaudeHost }).claude;
  if (!host?.use) return null;
  try {
    return ((await host.use("sample")) as SampleFn | null) ?? null;
  } catch {
    return null;
  }
}
