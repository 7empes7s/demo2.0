import { readFileSync } from "node:fs";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { checkPublished, type Published } from "../src/check-log.ts";
import { Store } from "../src/db.ts";
import { checkpointBody, encodeSigner, encodeVerifier, Fingerprints, generateSigner, MerkleTree, openCheckpoint, openNote, parseSigner, parseVerifier, signNote, stampDigest, verifyConsistency } from "../src/fingerprint.ts";
import { createDeskServer, fingerprintsFromEnv } from "../src/server.ts";

const vectors = (name: string) => JSON.parse(readFileSync(new URL(`../../../spec/record/vectors/${name}`, import.meta.url), "utf8"));
const rfc = vectors("rfc6962.json");
const d2 = vectors("d2-log.json");
const sha = (...b: Buffer[]) => createHash("sha256").update(Buffer.concat(b)).digest();
const rfcTree = new MerkleTree(rfc.leaves.map((hex: string) => sha(Buffer.from([0]), Buffer.from(hex, "hex"))));

/** A clock that can be moved to another day. */
function clock(start = "2026-10-07T23:00:00Z") {
  let t = Date.parse(start);
  const now = () => new Date((t += 1000)).toISOString();
  now.to = (iso: string) => (t = Date.parse(iso));
  return now;
}

function write(store: Store, n: number, tag = "x") {
  for (let i = 0; i < n; i++) store.append("test.event", "test", tag, { i }, () => null);
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("tree", () => {
  it("gives the RFC 6962 roots and consistency proofs", () => {
    expect(rfcTree.root(0).toString("hex")).toBe(rfc.empty_root);
    for (const [n, root] of Object.entries(rfc.roots)) expect(rfcTree.root(Number(n)).toString("hex")).toBe(root);
    for (const c of rfc.consistency) {
      expect(rfcTree.consistency(c.from, c.to).map((h) => h.toString("hex"))).toEqual(c.proof);
      expect(verifyConsistency(c.from, c.to, rfcTree.root(c.from), rfcTree.root(c.to), c.proof.map((h: string) => Buffer.from(h, "hex")))).toBe(true);
    }
  });

  it("proves every prefix of a larger tree, and rejects altered proofs", () => {
    const tree = new MerkleTree(Array.from({ length: 37 }, (_, i) => sha(Buffer.from([0, i]))));
    for (let m = 1; m <= 37; m++) {
      for (let n = m; n <= 37; n++) {
        const proof = tree.consistency(m, n);
        expect(verifyConsistency(m, n, tree.root(m), tree.root(n), proof)).toBe(true);
        if (proof.length) {
          const bad = proof.map((h, i) => (i === 0 ? sha(h) : h));
          expect(verifyConsistency(m, n, tree.root(m), tree.root(n), bad)).toBe(false);
        }
        if (m < n) expect(verifyConsistency(m, n, tree.root(m), sha(tree.root(n)), proof)).toBe(false);
      }
    }
  });
});

describe("keys and notes", () => {
  it("reads Record's checkpoints with Record's key", () => {
    const v = parseVerifier(d2.vkey);
    expect(encodeVerifier(v)).toBe(d2.vkey);
    for (const [size, note] of Object.entries(d2.checkpoints) as [string, string][]) expect(openCheckpoint(note, v).size).toBe(Number(size));
    const tampered = (d2.checkpoints["3"] as string).replace("\n3\n", "\n4\n");
    expect(() => openCheckpoint(tampered, v)).toThrow();
  });

  it("round-trips a signing key and rejects another log's key", () => {
    const s = generateSigner("example.org/desk");
    const again = parseSigner(encodeSigner(s));
    expect(encodeVerifier(again)).toBe(encodeVerifier(s));
    const note = signNote(checkpointBody({ origin: s.name, size: 3, root: sha(Buffer.from("r")), timestamp: 1 }), s);
    expect(openCheckpoint(note, parseVerifier(encodeVerifier(s))).size).toBe(3);
    expect(() => openNote(note, generateSigner("example.org/desk"))).toThrow(/no signature/);
    const forged = signNote(checkpointBody({ origin: "other.org/desk", size: 3, root: sha(Buffer.from("r")), timestamp: 1 }), s);
    expect(() => openCheckpoint(forged, s)).toThrow(/origin/);
  });
});

describe("daily fingerprints", () => {
  it("signs once per day over the event hashes and matches the chain", () => {
    const now = clock();
    const store = new Store(":memory:", now);
    const fp = new Fingerprints(store, generateSigner("example.org/desk"), { calendars: [] });
    write(store, 5);
    const first = fp.signDue()!;
    expect(first.day).toBe("2026-10-07");
    expect(first.size).toBe(5);
    expect(fp.signDue()).toBeNull();
    write(store, 3);
    expect(fp.signDue()).toBeNull();
    now.to("2026-10-08T00:00:30Z");
    const second = fp.signDue()!;
    expect(second.size).toBe(8);
    const cp = openCheckpoint(second.note, fp.signer);
    expect(cp.root.toString("base64")).toBe(second.root);
    expect(new Date(cp.timestamp * 1000).toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(fp.audit()).toEqual({ checked: 2, ok: true, mismatch_day: null });
  });

  it("keeps fingerprints append only and the receipt set once", () => {
    const store = new Store(":memory:", clock());
    const fp = new Fingerprints(store, generateSigner("example.org/desk"), { calendars: [] });
    write(store, 2);
    const row = fp.signDue()!;
    expect(() => store.db.prepare("UPDATE fingerprints SET root = 'x' WHERE day = ?").run(row.day)).toThrow(/append only/);
    expect(() => store.db.prepare("DELETE FROM fingerprints").run()).toThrow(/append only/);
    store.db.prepare("UPDATE fingerprints SET ots = ?, ots_calendar = 'c' WHERE day = ?").run(Buffer.from("a"), row.day);
    expect(() => store.db.prepare("UPDATE fingerprints SET ots = ? WHERE day = ?").run(Buffer.from("b"), row.day)).toThrow(/once/);
  });

  it("refuses to sign a broken chain", () => {
    const store = new Store(":memory:", clock());
    write(store, 3);
    store.db.exec("DROP TRIGGER events_no_update");
    store.db.prepare("UPDATE events SET payload = '{\"i\":9}' WHERE seq = 2").run();
    const fp = new Fingerprints(store, generateSigner("example.org/desk"), { calendars: [] });
    expect(() => fp.signDue()).toThrow(/broken at entry 2/);
  });

  it("gets a timestamp receipt from the first calendar that answers", async () => {
    const store = new Store(":memory:", clock());
    const calls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.startsWith("https://down")) return new Response("no", { status: 503 });
      expect(Buffer.from(init.body as Uint8Array).length).toBe(32);
      return new Response(new Uint8Array([0xf0, 0x01, 0xaa, 0x08, 0x00]));
    }) as typeof fetch;
    const fp = new Fingerprints(store, generateSigner("example.org/desk"), { calendars: ["https://down.example", "https://up.example/"], fetcher });
    write(store, 1);
    const row = fp.signDue()!;
    expect(await fp.anchorPending()).toBe(1);
    expect(await fp.anchorPending()).toBe(0);
    expect(calls).toEqual(["https://down.example/digest", "https://up.example/digest"]);
    const ots = Buffer.from(fp.get(row.day)!.ots!);
    const digest = createHash("sha256").update(row.note).digest();
    expect(ots.subarray(0, 31).toString("latin1")).toContain("OpenTimestamps");
    expect(ots.subarray(31, 33)).toEqual(Buffer.from([0x01, 0x08]));
    expect(ots.subarray(33, 65)).toEqual(digest);
    expect(fp.get(row.day)!.ots_calendar).toBe("https://up.example/");
    await expect(stampDigest(digest, ["https://down.example"], fetcher)).rejects.toThrow(/no calendar answered/);
  });

  it("makes the key file once, mode 600, and refuses a key of another name", () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-fp-"));
    const env = { DESK_DB: join(dir, "desk.db"), DESK_LOG_NAME: "example.org/desk", DESK_OTS_CALENDARS: "off" };
    expect(fingerprintsFromEnv(new Store(":memory:"), {})).toBeUndefined();
    const a = fingerprintsFromEnv(new Store(":memory:"), env)!;
    expect(statSync(join(dir, "log.key")).mode & 0o777).toBe(0o600);
    expect(fingerprintsFromEnv(new Store(":memory:"), env)!.verifierKey).toBe(a.verifierKey);
    expect(a.opts.calendars).toEqual([]);
    expect(() => fingerprintsFromEnv(new Store(":memory:"), { ...env, DESK_LOG_NAME: "other.org/desk" })).toThrow(/key of "example.org\/desk"/);
  });
});

describe("public routes and the outside check", () => {
  async function serve(store: Store, fp?: Fingerprints) {
    const server = createDeskServer({ store, fingerprints: fp, trustProxy: 0, writesPerMinute: 1000, readsPerMinute: 10_000 });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return async (path: string) => {
      const res = await fetch(base + path);
      return { status: res.status, body: (await res.json()) as any };
    };
  }

  it("publishes checkpoints and proofs to anyone, with nothing but hashes", async () => {
    const now = clock();
    const store = new Store(":memory:", now);
    const signer = generateSigner("example.org/desk");
    const fp = new Fingerprints(store, signer, { calendars: [] });
    write(store, 4, "resident-secret-subject");
    fp.signDue();
    now.to("2026-10-08T01:00:00Z");
    write(store, 9);
    fp.signDue();
    now.to("2026-10-09T01:00:00Z");
    fp.signDue();
    const get = await serve(store, fp);

    const list = await get("/fingerprints");
    expect(list.status).toBe(200);
    expect(list.body.key).toBe(encodeVerifier(signer));
    expect(list.body.days.map((d: any) => d.size)).toEqual([4, 13, 13]);
    expect(JSON.stringify(list.body)).not.toContain("resident-secret-subject");
    expect(JSON.stringify(list.body)).not.toContain(store.head().hash);

    expect((await get("/fingerprints/consistency?from=4&to=13")).body.proof.length).toBeGreaterThan(0);
    expect((await get("/fingerprints/consistency?from=0&to=13")).status).toBe(400);
    expect((await get("/fingerprints/consistency?from=4&to=99")).status).toBe(400);

    const proof = async (from: number, to: number) => (await get(`/fingerprints/consistency?from=${from}&to=${to}`)).body.proof;
    const good = await checkPublished(list.body, encodeVerifier(signer), proof);
    expect(good.ok).toBe(true);
    expect(good.lines.join("\n")).toContain("contains the day before's unchanged");

    // The same days saved earlier still check; a saved day that changed does not.
    expect((await checkPublished(list.body, encodeVerifier(signer), proof, list.body)).ok).toBe(true);
    const altered: Published = { ...list.body, days: [{ ...list.body.days[0], note: list.body.days[1].note }] };
    expect((await checkPublished(list.body, encodeVerifier(signer), proof, altered)).lines.at(-1)).toMatch(/no longer published/);
    // Another key: the check fails at the first day.
    expect((await checkPublished(list.body, encodeVerifier(generateSigner("example.org/desk")), proof)).ok).toBe(false);
  });

  it("catches a log rewritten and re-signed with the same key", async () => {
    const now = clock();
    const signer = generateSigner("example.org/desk");
    const honest = new Store(":memory:", now);
    const fpHonest = new Fingerprints(honest, signer, { calendars: [] });
    write(honest, 6);
    const day1 = fpHonest.signDue()!;

    // The box's owner rebuilds the log with entry 3 changed, then keeps signing as if nothing happened.
    now.to("2026-10-07T23:00:00Z");
    const forged = new Store(":memory:", now);
    const fpForged = new Fingerprints(forged, signer, { calendars: [] });
    write(forged, 2);
    forged.append("test.event", "test", "x", { i: "changed" }, () => null);
    write(forged, 3);
    forged.db.prepare("INSERT INTO fingerprints (day, size, root, note, signed_at) VALUES (?, ?, ?, ?, ?)").run(day1.day, day1.size, day1.root, day1.note, day1.signed_at);
    now.to("2026-10-08T01:00:00Z");
    write(forged, 2);
    fpForged.signDue();

    const get = await serve(forged, fpForged);
    const list = (await get("/fingerprints")).body;
    const proof = async (from: number, to: number) => (await get(`/fingerprints/consistency?from=${from}&to=${to}`)).body.proof;
    const result = await checkPublished(list, encodeVerifier(signer), proof);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/2026-10-08: the log of 2026-10-07 is not contained unchanged/);
    // The auditor's replay sees it too.
    expect(fpForged.audit()).toEqual({ checked: 2, ok: false, mismatch_day: "2026-10-07" });
  });

  it("says when the fingerprint is not set up", async () => {
    const get = await serve(new Store(":memory:"));
    expect((await get("/fingerprints")).body).toEqual({ enabled: false, days: [] });
    expect((await get("/fingerprints/consistency?from=1&to=1")).status).toBe(404);
  });
});
