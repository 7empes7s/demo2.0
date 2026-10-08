/**
 * Reading answers from the other services (Agora, Provenance, Commons) without trusting their size:
 * a body is read as a stream and dropped as soon as it passes a byte cap, so one oversized answer
 * can never use up the Companion's memory.
 */

/** Most bytes the Companion reads from any one answer of another service. */
export const MAX_UPSTREAM_BYTES = 16 * 1024 * 1024;
/** Most bytes read from a small answer: an error code or a /healthz. */
export const MAX_SMALL_BYTES = 64 * 1024;

/** Every request to another service: one hop only, never a redirect. */
export const UPSTREAM: RequestInit = { redirect: "error" };

/** An answer was larger than the cap; the rest of it was not read. */
export class TooLarge extends Error {}

/**
 * Parses a JSON body of at most `maxBytes` bytes. Throws TooLarge past the cap (and cancels the
 * rest of the stream), a SyntaxError when it is not JSON, and the fetch's own error on a timeout.
 * Pass the fetch's `signal` to be sure a body that stalls after the headers is cut off when it
 * fires: fetch does not always error a body stream it has already handed over.
 */
export async function readJson(res: Response, maxBytes = MAX_UPSTREAM_BYTES, signal?: AbortSignal): Promise<unknown> {
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new TooLarge(`answer is larger than ${maxBytes} bytes`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    // Cancelling ends a pending read with done, so the abort is rethrown below.
    const stop = () => void reader.cancel(signal?.reason).catch(() => {});
    signal?.addEventListener("abort", stop, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new TooLarge(`answer is larger than ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(all));
}
