/**
 * Desk's HTTP service. One process, no framework, loopback only on Mulinux: the Companion server
 * forwards `/api/desk/*` to it, so the browser talks to one origin.
 *
 *   DESK_DB                  SQLite file (default desk.db; ":memory:" for tests)
 *   PORT                     default 8094
 *   HOST                     default 127.0.0.1
 *   TRUST_PROXY              reverse proxies in front (the Companion counts as one): default 1
 *   DESK_BOOTSTRAP_PASSWORD  with an empty staff table, creates the admin "admin" with it on start
 *   DESK_SEED                a JSON file loaded once into an empty store (see seed.ts)
 *   LLM_BASE_URL, LLM_MODEL, LLM_API_KEY, LLM_TIMEOUT_MS   the model, unless the admin set one in Desk
 *   DESK_LOG_NAME            the log's public name (e.g. example.org/desk); turns on the daily fingerprint
 *   DESK_LOG_KEY             its signing key file (default log.key next to DESK_DB; made on first start, mode 600)
 *   DESK_OTS_CALENDARS       OpenTimestamps calendars, comma separated ("off" for none; default the public pool)
 *
 * Who is asking: staff carry `Authorization: Staff <token>` (from POST /staff/login); residents
 * carry `Authorization: Resident <token>` (from POST /enrol). Nothing is a cookie, so a page on
 * another site cannot act for anyone.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Ai, CATEGORIES, LANGS, type Lang } from "./ai.ts";
import { createEnrolCodes, createStaff, DeskError, enrol, enrolBatches, listStaff, login, logout, residentFromToken, type Staff, staffFromToken, updateStaff } from "./auth.ts";
import type { Role } from "./db.ts";
import { Store } from "./db.ts";
import * as desk from "./desk.ts";
import { DEFAULT_CALENDARS, encodeSigner, Fingerprints, generateSigner, LEAF_FORMAT, parseSigner, publicDay } from "./fingerprint.ts";
import { loadSeed } from "./seed.ts";

export interface ServerOptions {
  store: Store;
  ai?: Ai;
  /** The daily public fingerprint; without it /fingerprints says it is not set up. */
  fingerprints?: Fingerprints;
  trustProxy?: number;
  /** Requests per client per minute on writes (default 30) and reads (default 240). */
  writesPerMinute?: number;
  readsPerMinute?: number;
}

const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 10_000;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new DeskError(413, "request too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new DeskError(400, "body must be a JSON object");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

type Who = { staff: Staff | null; resident: { id: string; created_at: string } | null };

export function createDeskServer(opts: ServerOptions) {
  const { store } = opts;
  const ai = opts.ai ?? new Ai(store);
  const trustProxy = opts.trustProxy ?? 1;
  const writes = new Map<string, number[]>();
  const reads = new Map<string, number[]>();
  const logins = new Map<string, number[]>();

  const clientOf = (req: IncomingMessage): string => {
    const socket = req.socket.remoteAddress ?? "?";
    if (trustProxy <= 0) return socket;
    const chain = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return chain[chain.length - trustProxy] ?? chain[0] ?? socket;
  };

  const throttle = (req: IncomingMessage, bucket: Map<string, number[]>, max: number) => {
    const who = clientOf(req);
    const now = Date.now();
    const recent = (bucket.get(who) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= max) throw new DeskError(429, "too many requests, try again in a minute");
    recent.push(now);
    if (!bucket.has(who) && bucket.size >= MAX_CLIENTS) {
      for (const [key, times] of bucket) if (times.every((t) => now - t >= 60_000)) bucket.delete(key);
      if (bucket.size >= MAX_CLIENTS) bucket.clear();
    }
    bucket.set(who, recent);
  };

  const whoIs = (req: IncomingMessage): Who => {
    const header = String(req.headers.authorization ?? "");
    const m = /^(Staff|Resident)\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!m) return { staff: null, resident: null };
    if (m[1] === "Staff") return { staff: staffFromToken(store, m[2]), resident: null };
    return { staff: null, resident: residentFromToken(store, m[2]) };
  };

  const needStaff = (who: Who, ...roles: Role[]): Staff => {
    if (!who.staff) throw new DeskError(401, "staff sign-in needed");
    if (roles.length && !roles.includes(who.staff.role)) throw new DeskError(403, `this needs the ${roles.join(" or ")} role`);
    return who.staff;
  };
  const needResident = (who: Who) => {
    if (!who.resident) throw new DeskError(401, "an enrolment code is needed for this");
    return who.resident;
  };
  const by = (s: Staff) => `staff:${s.id}`;

  function procedureView(p: desk.Procedure, who: Who) {
    return {
      ...p,
      updates: desk.procedureUpdates(store, p.id),
      verdicts: desk.verdictCounts(store, p.id),
      my_verdict: who.resident ? desk.myVerdict(store, p.id, who.resident.id) : null,
      answers: desk.publicAnswers(store, "procedure", p.id),
      ideas: store.db.prepare("SELECT id, title, lang, status FROM ideas WHERE procedure_id = ? ORDER BY created_at").all(p.id),
    };
  }

  function ideaView(i: desk.Idea, who: Who) {
    return {
      ...i,
      supported: who.resident ? desk.supports(store, who.resident.id, i.id) : false,
      mine: who.resident ? desk.isProposer(store, who.resident.id, i.id) : false,
      answers: desk.publicAnswers(store, "idea", i.id),
    };
  }

  async function route(req: IncomingMessage, url: URL): Promise<{ status: number; body: unknown }> {
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const parts = path.split("/").slice(1);
    const who = whoIs(req);
    const q = url.searchParams;
    const ok = (body: unknown, status = 200) => ({ status, body });
    const isWrite = method !== "GET";
    if (isWrite && method !== "POST" && method !== "PATCH" && method !== "DELETE") throw new DeskError(405, "method not allowed");
    throttle(req, isWrite ? writes : reads, isWrite ? (opts.writesPerMinute ?? 30) : (opts.readsPerMinute ?? 240));
    const body = isWrite ? await readBody(req) : {};

    if (path === "/healthz" && method === "GET") {
      desk.closeDueRounds(store);
      const counts = (sql: string) => (store.db.prepare(sql).get() as { n: number }).n;
      return ok({
        ok: true,
        procedures: counts("SELECT COUNT(*) AS n FROM procedures"),
        ideas: counts("SELECT COUNT(*) AS n FROM ideas"),
        feedback: counts("SELECT COUNT(*) AS n FROM feedback"),
        rounds: counts("SELECT COUNT(*) AS n FROM rounds WHERE status != 'draft'"),
        residents: counts("SELECT COUNT(*) AS n FROM residents"),
        staff: counts("SELECT COUNT(*) AS n FROM staff WHERE disabled = 0"),
        ai: ai.info(),
        log: store.head(),
      });
    }

    /* ---- public settings */
    if (path === "/settings/public" && method === "GET") return ok(publicSettings());

    /* ---- residents */
    if (path === "/enrol" && method === "POST") return ok(enrol(store, String(body.code ?? "")));
    if (path === "/me" && method === "GET") {
      const r = needResident(who);
      return ok({ enrolled: true, since: r.created_at });
    }

    /* ---- procedures */
    if (parts[0] === "procedures") {
      desk.closeDueRounds(store);
      if (parts.length === 1 && method === "GET") return ok({ procedures: desk.listProcedures(store, { status: q.get("status") ?? undefined, kind: q.get("kind") ?? undefined }).map((p) => ({ ...p, verdicts: desk.verdictCounts(store, p.id) })) });
      if (parts.length === 1 && method === "POST") return ok(procedureView(desk.createProcedure(store, by(needStaff(who, "operator", "admin")), body), who), 201);
      const p = desk.getProcedure(store, parts[1]);
      if (!p) throw new DeskError(404, "no such procedure");
      if (parts.length === 2 && method === "GET") return ok(procedureView(p, who));
      if (parts.length === 2 && method === "PATCH") return ok(procedureView(desk.updateProcedure(store, by(needStaff(who, "operator", "admin")), p.id, body), who));
      if (parts[2] === "updates" && method === "POST") return ok(desk.addProcedureUpdate(store, by(needStaff(who, "operator", "admin")), p.id, body), 201);
      if (parts[2] === "verdict" && method === "POST") {
        const r = needResident(who);
        return ok({ verdicts: desk.giveVerdict(store, r.id, p.id, body), my_verdict: desk.myVerdict(store, p.id, r.id) });
      }
    }

    /* ---- ideas */
    if (parts[0] === "ideas") {
      if (parts.length === 1 && method === "GET") return ok({ ideas: desk.listIdeas(store, { status: q.get("status") ?? undefined, limit: Number(q.get("limit")) || undefined }).map((i) => ideaView(i, who)) });
      if (parts.length === 1 && method === "POST") return ok(ideaView(desk.postIdea(store, needResident(who).id, body), who), 201);
      const idea = desk.getIdea(store, parts[1]);
      if (!idea) throw new DeskError(404, "no such idea");
      if (parts.length === 2 && method === "GET") return ok(ideaView(idea, who));
      if (parts[2] === "support" && method === "POST") return ok(ideaView(desk.support(store, needResident(who).id, idea.id, true), who));
      if (parts[2] === "support" && method === "DELETE") return ok(ideaView(desk.support(store, needResident(who).id, idea.id, false), who));
      if (parts[2] === "decision" && method === "POST") return ok(ideaView(desk.decideIdea(store, by(needStaff(who, "operator", "admin")), idea.id, body), who));
    }

    /* ---- feedback */
    if (parts[0] === "feedback") {
      if (parts.length === 1 && method === "POST") {
        const f = desk.fileFeedback(store, who.resident?.id ?? null, body);
        return ok({ code: f.code, status: f.status, created_at: f.created_at }, 201);
      }
      if (parts.length === 1 && method === "GET") {
        needStaff(who, "operator", "admin");
        return ok({ feedback: desk.listFeedback(store, { status: q.get("status") ?? undefined, about_kind: q.get("about_kind") ?? undefined, about_id: q.get("about_id") ?? undefined }) });
      }
      if (parts[1] === "by-code" && parts.length === 3 && method === "GET") {
        const f = desk.feedbackByCode(store, parts[2]);
        if (!f) throw new DeskError(404, "no message with that code");
        // The resident sees their own message, its status and the answer; never staff names.
        return ok({ code: f.code, status: f.status, category: f.category, lang: f.lang, text: f.text, about_kind: f.about_kind, about_id: f.about_id, answer: f.answer, answered_at: f.answered_at, created_at: f.created_at });
      }
      const f = desk.getFeedback(store, parts[1]);
      if (!f) throw new DeskError(404, "no such feedback");
      const staff = needStaff(who, "operator", "admin");
      if (parts.length === 2 && method === "GET") return ok(f);
      if (parts.length === 2 && method === "PATCH") return ok(desk.reviewFeedback(store, by(staff), f.id, body));
      if (parts[2] === "answer" && method === "POST") return ok(desk.answerFeedback(store, by(staff), f.id, body));
      if (parts[2] === "triage" && method === "POST") {
        const t = await ai.triage(f.text, staff.id);
        return ok({ suggestion: t, labelled: "A model wrote this suggestion; an operator decides." });
      }
      if (parts[2] === "draft" && method === "POST") {
        const context = typeof body.context === "string" ? body.context.slice(0, 4000) : "";
        return ok({ draft: await ai.draftAnswer(f.text, f.lang, context, staff.id), labelled: "A model wrote this draft; an operator edits and signs it." });
      }
    }

    /* ---- votes */
    if (parts[0] === "rounds") {
      desk.closeDueRounds(store);
      if (parts.length === 1 && method === "GET") {
        const includeDrafts = !!who.staff && q.get("drafts") === "1";
        return ok({ rounds: desk.listRounds(store, { status: q.get("status") ?? undefined, includeDrafts }).map((r) => desk.roundForPublic(store, r)) });
      }
      if (parts.length === 1 && method === "POST") return ok(desk.createRound(store, by(needStaff(who, "operator", "admin")), body), 201);
      const r = desk.getRound(store, parts[1]);
      if (!r || (r.status === "draft" && !who.staff)) throw new DeskError(404, "no such vote");
      if (parts.length === 2 && method === "GET") return ok({ ...desk.roundForPublic(store, r), my_ballot: who.resident ? desk.myBallot(store, who.resident.id, r.id) : null });
      if (parts.length === 2 && method === "PATCH") return ok(desk.updateRound(store, by(needStaff(who, "operator", "admin")), r.id, body));
      if (parts[2] === "ballots" && method === "POST") return ok(desk.castBallot(store, needResident(who).id, r.id, body), 201);
      if ((parts[2] === "open" || parts[2] === "close" || parts[2] === "publish") && method === "POST") {
        const to = parts[2] === "open" ? "open" : parts[2] === "close" ? "closed" : "published";
        return ok(desk.moveRound(store, by(needStaff(who, "operator", "admin")), r.id, to));
      }
      if (parts[2] === "ballots" && method === "GET") {
        needStaff(who, "auditor", "admin");
        return ok({ ballots: desk.ballotsOf(store, r.id), recount: desk.tally(store, r.id), published: r.result });
      }
    }

    /* ---- staff */
    if (parts[0] === "staff") {
      if (parts[1] === "login" && method === "POST") {
        // Ten sign-in tries per client per minute, on top of the write limit.
        throttle(req, logins, 10);
        const out = login(store, String(body.login ?? ""), String(body.password ?? ""));
        return ok({ token: out.token, staff: out.staff });
      }
      if (parts[1] === "logout" && method === "POST") {
        const m = /^Staff\s+(\S+)$/.exec(String(req.headers.authorization ?? ""));
        if (m) logout(store, m[1]);
        return ok({ ok: true });
      }
      if (parts[1] === "me" && method === "GET") return ok(needStaff(who));
      if (parts.length === 1 && method === "GET") {
        needStaff(who, "admin");
        return ok({ staff: listStaff(store) });
      }
      if (parts.length === 1 && method === "POST") {
        const admin = needStaff(who, "admin");
        return ok(createStaff(store, by(admin), { login: String(body.login ?? ""), name: String(body.name ?? ""), role: body.role as Role, password: String(body.password ?? "") }), 201);
      }
      if (parts.length === 2 && method === "PATCH") {
        const admin = needStaff(who, "admin");
        const patch: Parameters<typeof updateStaff>[3] = {};
        if (body.name !== undefined) patch.name = String(body.name);
        if (body.role !== undefined) patch.role = body.role as Role;
        if (body.disabled !== undefined) patch.disabled = body.disabled === true;
        if (body.password !== undefined) patch.password = String(body.password);
        return ok(updateStaff(store, by(admin), parts[1], patch));
      }
    }

    /* ---- enrolment codes (admin) */
    if (path === "/enrol-codes" && method === "POST") {
      const admin = needStaff(who, "admin");
      return ok({ codes: createEnrolCodes(store, by(admin), String(body.batch ?? ""), Number(body.count)) }, 201);
    }
    if (path === "/enrol-codes" && method === "GET") {
      needStaff(who, "admin", "auditor");
      return ok({ batches: enrolBatches(store) });
    }

    /* ---- settings (admin) */
    if (path === "/settings" && method === "GET") {
      needStaff(who, "admin");
      return ok(adminSettings());
    }
    if (path === "/settings" && method === "PATCH") {
      const admin = needStaff(who, "admin");
      return ok(patchSettings(admin, body));
    }
    if (path === "/ai/test" && method === "POST") return ok(await ai.test(needStaff(who, "admin").id));
    if (path === "/ai/translate" && method === "POST") {
      const staff = needStaff(who, "operator", "admin");
      const from = body.from as Lang;
      const to = Array.isArray(body.to) ? (body.to as Lang[]) : [];
      if (!LANGS.includes(from) || to.some((l) => !LANGS.includes(l))) throw new DeskError(400, "from and to must be language codes");
      const textToTranslate = typeof body.text === "string" ? body.text.trim() : "";
      if (!textToTranslate) throw new DeskError(400, "text is empty");
      return ok({ translations: await ai.translate(textToTranslate.slice(0, 4000), from, to, staff.id), labelled: "A model wrote these; an operator checks them before they are shown." });
    }

    /* ---- the daily fingerprint (anyone) */
    if (parts[0] === "fingerprints" && method === "GET") {
      const fp = opts.fingerprints;
      if (parts.length === 1) {
        if (!fp) return ok({ enabled: false, days: [] });
        return ok({ enabled: true, key: fp.verifierKey, origin: fp.signer.name, leaf_format: LEAF_FORMAT, size_now: store.head().seq, days: fp.all().map(publicDay) });
      }
      if (parts[1] === "consistency" && parts.length === 2) {
        if (!fp) throw new DeskError(404, "the daily fingerprint is not set up on this server");
        const from = Number(q.get("from"));
        const to = Number(q.get("to"));
        // Proofs between published sizes only: that is all a check needs.
        const max = Math.max(0, ...fp.all().map((d) => d.size));
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || from > to || to > max) throw new DeskError(400, `need 0 < from <= to <= ${max}, the largest published size`);
        const tree = fp.publishedTree();
        return ok({ from, to, proof: tree.consistency(from, to).map((h) => h.toString("base64")) });
      }
    }

    /* ---- audit (auditor, admin) */
    if (parts[0] === "audit") {
      needStaff(who, "auditor", "admin");
      if (parts[1] === "verify" && method === "GET") return ok({ ...store.verify(), fingerprints: opts.fingerprints?.audit() ?? null });
      if (parts[1] === "events" && method === "GET") {
        return ok({ events: store.events({ from: Number(q.get("from")) || undefined, kind: q.get("kind") ?? undefined, subject: q.get("subject") ?? undefined, limit: Number(q.get("limit")) || undefined }).map((e) => ({ ...e, payload: JSON.parse(e.payload) })) });
      }
      if (parts[1] === "ai-calls" && method === "GET") {
        const desk_calls = store.db.prepare("SELECT at, purpose, model, prompt_sha256, input_chars, output_chars, ms, ok, error FROM ai_calls ORDER BY at DESC LIMIT 500").all();
        return ok({ desk_calls });
      }
      if (parts[1] === "summary" && method === "GET") {
        const n = (sql: string) => (store.db.prepare(sql).get() as { n: number }).n;
        return ok({
          log: store.verify(),
          counts: {
            events: n("SELECT COUNT(*) AS n FROM events"),
            residents: n("SELECT COUNT(*) AS n FROM residents"),
            codes_issued: n("SELECT COUNT(*) AS n FROM enrol_codes"),
            codes_used: n("SELECT COUNT(*) AS n FROM enrol_codes WHERE used_at IS NOT NULL"),
            procedures: n("SELECT COUNT(*) AS n FROM procedures"),
            ideas: n("SELECT COUNT(*) AS n FROM ideas"),
            feedback: n("SELECT COUNT(*) AS n FROM feedback"),
            feedback_answered: n("SELECT COUNT(*) AS n FROM feedback WHERE answer IS NOT NULL"),
            rounds: n("SELECT COUNT(*) AS n FROM rounds"),
            ballots: n("SELECT COUNT(*) AS n FROM ballots"),
            ai_calls: n("SELECT COUNT(*) AS n FROM ai_calls"),
          },
          staff: listStaff(store).map((s) => ({ id: s.id, name: s.name, role: s.role, disabled: s.disabled })),
        });
      }
    }

    throw new DeskError(404, "not found");
  }

  function publicSettings() {
    return {
      commune: store.setting("commune.name") ?? "Esch-sur-Alzette",
      languages: (store.setting("commune.languages") ?? "fr,lb,de,en,pt").split(","),
      intro: JSON.parse(store.setting("commune.intro") ?? "{}"),
      ai: ai.info(),
    };
  }
  function adminSettings() {
    const s = publicSettings();
    return {
      ...s,
      ai: { ...s.ai, base_url: store.setting("ai.base_url") ?? "", key_set: !!store.setting("ai.api_key"), from_env: !store.setting("ai.base_url") && !!process.env.LLM_BASE_URL },
    };
  }
  function patchSettings(admin: Staff, body: Record<string, unknown>) {
    const changes: Record<string, unknown> = {};
    const setText = (key: string, value: unknown, max: number) => {
      if (value === undefined) return;
      if (typeof value !== "string") throw new DeskError(400, `${key} must be text`);
      store.setSetting(key, value.trim().slice(0, max));
      changes[key] = key === "ai.api_key" ? "(set)" : value.trim().slice(0, max);
    };
    store.append("settings.changed", by(admin), "settings", changes, () => {
      setText("commune.name", body.commune, 80);
      if (body.languages !== undefined) {
        const langs = Array.isArray(body.languages) ? body.languages.filter((l) => (LANGS as readonly string[]).includes(String(l))) : [];
        if (!langs.length) throw new DeskError(400, "languages must list at least one of lb, fr, de, en, pt");
        store.setSetting("commune.languages", langs.join(","));
        changes["commune.languages"] = langs;
      }
      if (body.intro !== undefined) {
        const intro = desk.localized(body.intro, "intro", 600, false);
        store.setSetting("commune.intro", JSON.stringify(intro));
        changes["commune.intro"] = intro;
      }
      const aiPatch = (body.ai ?? {}) as Record<string, unknown>;
      if (aiPatch.base_url !== undefined && aiPatch.base_url !== "" && !/^https?:\/\//.test(String(aiPatch.base_url))) throw new DeskError(400, "the model address must start with http:// or https://");
      setText("ai.base_url", aiPatch.base_url, 300);
      setText("ai.model", aiPatch.model, 120);
      setText("ai.api_key", aiPatch.api_key, 500);
      if (aiPatch.timeout_ms !== undefined) {
        const t = Number(aiPatch.timeout_ms);
        if (!Number.isInteger(t) || t < 1000 || t > 600_000) throw new DeskError(400, "timeout_ms must be 1000 to 600000");
        store.setSetting("ai.timeout_ms", String(t));
        changes["ai.timeout_ms"] = t;
      }
    });
    return adminSettings();
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const out = await route(req, url);
      send(res, out.status, out.body);
    } catch (e) {
      const status = e instanceof DeskError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof DeskError ? e.message : "something went wrong" });
    }
  });
}

/** Creates the first admin from the environment when no staff exists yet. */
export function bootstrap(store: Store, env: Record<string, string | undefined> = process.env) {
  const n = (store.db.prepare("SELECT COUNT(*) AS n FROM staff").get() as { n: number }).n;
  if (n === 0 && env.DESK_BOOTSTRAP_PASSWORD) {
    createStaff(store, "system", { login: env.DESK_BOOTSTRAP_LOGIN || "admin", name: "Administrator", role: "admin", password: env.DESK_BOOTSTRAP_PASSWORD });
    console.log(`created the first admin "${env.DESK_BOOTSTRAP_LOGIN || "admin"}" from DESK_BOOTSTRAP_PASSWORD`);
  } else if (n === 0) console.warn("no staff yet and DESK_BOOTSTRAP_PASSWORD is not set: nobody can sign in to the portals");
}

/**
 * The fingerprint signer from the environment: none without DESK_LOG_NAME. The key file is made
 * on first start (mode 600) and kept; a key made for another name is refused, never replaced.
 */
export function fingerprintsFromEnv(store: Store, env: Record<string, string | undefined> = process.env): Fingerprints | undefined {
  const name = env.DESK_LOG_NAME?.trim();
  if (!name) return undefined;
  const db = env.DESK_DB || "desk.db";
  const path = env.DESK_LOG_KEY || join(db === ":memory:" ? "." : dirname(db), "log.key");
  let signer;
  if (existsSync(path)) {
    signer = parseSigner(readFileSync(path, "utf8"));
    if (signer.name !== name) throw new Error(`${path} is the key of "${signer.name}", not "${name}"`);
  } else {
    signer = generateSigner(name);
    writeFileSync(path, encodeSigner(signer) + "\n", { mode: 0o600, flag: "wx" });
    console.log(`made the log's signing key ${path}`);
  }
  const cal = env.DESK_OTS_CALENDARS?.trim();
  const calendars = !cal ? DEFAULT_CALENDARS : cal === "off" ? [] : cal.split(",").map((c) => c.trim()).filter(Boolean);
  return new Fingerprints(store, signer, { calendars });
}

/** Signs today's checkpoint if due, then sends unstamped ones to a calendar. Never throws. */
export async function fingerprintTick(fp: Fingerprints) {
  try {
    const row = fp.signDue();
    if (row) console.log(`fingerprint ${row.day}: ${row.size} entries, root ${row.root}`);
  } catch (e) {
    console.error(`fingerprint: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const n = await fp.anchorPending();
    if (n) console.log(`fingerprint: ${n} receipt(s) from the timestamp calendar`);
  } catch (e) {
    console.error(`fingerprint timestamp: ${e instanceof Error ? e.message : e}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const store = new Store(process.env.DESK_DB || "desk.db");
  bootstrap(store);
  if (process.env.DESK_SEED) {
    const loaded = loadSeed(store, JSON.parse(await readFile(process.env.DESK_SEED, "utf8")));
    if (loaded) console.log(`seed loaded from ${process.env.DESK_SEED}`);
  }
  const port = Number(process.env.PORT ?? 8094);
  const host = process.env.HOST || "127.0.0.1";
  const fingerprints = fingerprintsFromEnv(store);
  if (fingerprints) console.log(`daily fingerprint on, key ${fingerprints.verifierKey}`);
  else console.log("daily fingerprint off (DESK_LOG_NAME is not set)");
  const server = createDeskServer({ store, fingerprints, trustProxy: Number(process.env.TRUST_PROXY ?? 1) || 0 });
  // Votes close on time even when nobody is reading.
  setInterval(() => {
    try {
      desk.closeDueRounds(store);
    } catch (e) {
      console.error(e);
    }
  }, 60_000).unref();
  // One checkpoint per UTC day, signed at the first tick of the day; receipts retried hourly.
  if (fingerprints) {
    void fingerprintTick(fingerprints);
    setInterval(() => void fingerprintTick(fingerprints), 3_600_000).unref();
  }
  server.listen(port, host, () => console.log(`desk listening on ${host}:${port}`));
}
