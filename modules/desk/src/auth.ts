/**
 * Who is asking. Staff (admin, operator, auditor) sign in with a login and a password and get a
 * session token. Residents hold a token they got once from an enrolment code the commune issued;
 * Desk stores only hashes, never a name, and never links a resident to the code's batch beyond
 * what the code itself says. Secure sign-in (Door) replaces this in a later phase.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { newId, type Role, sha256, Store } from "./db.ts";

export interface Staff {
  id: string;
  login: string;
  name: string;
  role: Role;
  disabled: boolean;
  created_at: string;
}

export const ROLES: readonly Role[] = ["admin", "operator", "auditor"];

/** A staff row as SQLite returns it. */
type StaffRow = Omit<Staff, "disabled"> & { disabled: number; pass_hash: string; salt: string };
const SESSION_DAYS = 14;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}

export function createStaff(store: Store, by: string, input: { login: string; name: string; role: Role; password: string }): Staff {
  const login = input.login.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(login)) throw new DeskError(400, "login must be 2 to 40 letters, digits, dots, dashes or underscores");
  if (!ROLES.includes(input.role)) throw new DeskError(400, "role must be admin, operator or auditor");
  if (input.password.length < 10) throw new DeskError(400, "password must be at least 10 characters");
  const name = input.name.trim().slice(0, 80) || login;
  const salt = randomBytes(16).toString("hex");
  const id = newId();
  const created_at = store.now();
  if (store.db.prepare("SELECT 1 FROM staff WHERE login = ?").get(login)) throw new DeskError(409, "that login exists already");
  store.append("staff.created", by, `staff:${id}`, { login, name, role: input.role }, () => {
    store.db
      .prepare("INSERT INTO staff (id, login, name, role, pass_hash, salt, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, ?, 0)")
      .run(id, login, name, input.role, hashPassword(input.password, salt), salt, created_at);
  });
  return { id, login, name, role: input.role, disabled: false, created_at };
}

export function updateStaff(store: Store, by: string, id: string, patch: { name?: string; role?: Role; disabled?: boolean; password?: string }): Staff {
  const row = store.db.prepare("SELECT * FROM staff WHERE id = ?").get(id) as StaffRow | undefined;
  if (!row) throw new DeskError(404, "no such staff member");
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 80) || row.login : row.name;
  const role = patch.role ?? row.role;
  if (!ROLES.includes(role)) throw new DeskError(400, "role must be admin, operator or auditor");
  const disabled = patch.disabled ?? !!row.disabled;
  if (patch.password !== undefined && patch.password.length < 10) throw new DeskError(400, "password must be at least 10 characters");
  // The last working admin cannot be demoted or switched off: someone must be able to sign in.
  if (row.role === "admin" && (role !== "admin" || disabled)) {
    const admins = (store.db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin' AND disabled = 0 AND id != ?").get(id) as { n: number }).n;
    if (admins === 0) throw new DeskError(409, "that is the last admin");
  }
  const salt = patch.password !== undefined ? randomBytes(16).toString("hex") : row.salt;
  const pass_hash = patch.password !== undefined ? hashPassword(patch.password, salt) : row.pass_hash;
  store.append("staff.updated", by, `staff:${id}`, { name, role, disabled, password_changed: patch.password !== undefined }, () => {
    store.db.prepare("UPDATE staff SET name = ?, role = ?, disabled = ?, pass_hash = ?, salt = ? WHERE id = ?").run(name, role, disabled ? 1 : 0, pass_hash, salt, id);
    if (disabled || patch.password !== undefined) store.db.prepare("DELETE FROM staff_sessions WHERE staff_id = ?").run(id);
  });
  return { id, login: row.login, name, role, disabled, created_at: row.created_at };
}

export function listStaff(store: Store): Staff[] {
  const rows = store.db.prepare("SELECT id, login, name, role, disabled, created_at FROM staff ORDER BY created_at").all() as unknown as (Omit<Staff, "disabled"> & { disabled: number })[];
  return rows.map((r) => ({ ...r, disabled: !!r.disabled }));
}

/** Signs a staff member in. The same answer for an unknown login and a wrong password. */
export function login(store: Store, loginName: string, password: string): { token: string; staff: Staff } {
  const row = store.db.prepare("SELECT * FROM staff WHERE login = ?").get(loginName.trim().toLowerCase()) as StaffRow | undefined;
  const expected = row ? Buffer.from(row.pass_hash, "hex") : Buffer.alloc(32);
  const given = Buffer.from(hashPassword(password, row?.salt ?? "0".repeat(32)), "hex");
  if (!row || row.disabled || !timingSafeEqual(expected, given)) throw new DeskError(401, "wrong login or password");
  const token = randomBytes(32).toString("base64url");
  const created_at = store.now();
  const expires_at = new Date(Date.parse(created_at) + SESSION_DAYS * 86_400_000).toISOString();
  store.append("staff.signed_in", `staff:${row.id}`, `staff:${row.id}`, {}, () => {
    store.db.prepare("INSERT INTO staff_sessions (token_hash, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), row.id, created_at, expires_at);
  });
  return { token, staff: { id: row.id, login: row.login, name: row.name, role: row.role, disabled: false, created_at: row.created_at } };
}

export function logout(store: Store, token: string) {
  store.db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").run(sha256(token));
}

export function staffFromToken(store: Store, token: string | null): Staff | null {
  if (!token) return null;
  const row = store.db
    .prepare(
      "SELECT s.id, s.login, s.name, s.role, s.disabled, s.created_at, e.expires_at FROM staff_sessions e JOIN staff s ON s.id = e.staff_id WHERE e.token_hash = ?",
    )
    .get(sha256(token)) as (Omit<Staff, "disabled"> & { disabled: number; expires_at: string }) | undefined;
  if (!row || row.disabled || row.expires_at < store.now()) return null;
  return { id: row.id, login: row.login, name: row.name, role: row.role, disabled: false, created_at: row.created_at };
}

/** Makes `count` one-time enrolment codes. They are shown once; Desk keeps only their hashes. */
export function createEnrolCodes(store: Store, by: string, batch: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new DeskError(400, "count must be 1 to 5000");
  const label = batch.trim().slice(0, 80) || "batch";
  const codes: string[] = [];
  const at = store.now();
  store.append("enrol.codes_issued", by, `batch:${label}`, { batch: label, count }, () => {
    const insert = store.db.prepare("INSERT INTO enrol_codes (code_hash, batch, created_at) VALUES (?, ?, ?)");
    for (let i = 0; i < count; i++) {
      // 12 base32 characters, grouped by 4 for reading aloud at a counter: xxxx-xxxx-xxxx.
      const raw = newId(12);
      const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      insert.run(sha256(code), label, at);
      codes.push(code);
    }
  });
  return codes;
}

export function enrolBatches(store: Store): { batch: string; created_at: string; issued: number; used: number }[] {
  return store.db
    .prepare("SELECT batch, MIN(created_at) AS created_at, COUNT(*) AS issued, SUM(used_at IS NOT NULL) AS used FROM enrol_codes GROUP BY batch ORDER BY created_at DESC")
    .all() as unknown as { batch: string; created_at: string; issued: number; used: number }[];
}

/** Turns an unused code into a resident token. The code is spent, whatever the client does next. */
export function enrol(store: Store, code: string): { token: string; resident_id: string } {
  const normalised = code.trim().toLowerCase().replace(/[^0-9a-z]/g, "");
  if (normalised.length !== 12) throw new DeskError(400, "a code has 12 letters and digits");
  const formatted = `${normalised.slice(0, 4)}-${normalised.slice(4, 8)}-${normalised.slice(8, 12)}`;
  const codeHash = sha256(formatted);
  const row = store.db.prepare("SELECT used_at FROM enrol_codes WHERE code_hash = ?").get(codeHash) as { used_at: string | null } | undefined;
  if (!row) throw new DeskError(404, "unknown code");
  if (row.used_at) throw new DeskError(409, "this code was used already");
  const token = randomBytes(32).toString("base64url");
  const resident_id = newId();
  const at = store.now();
  store.append("resident.enrolled", `resident:${resident_id}`, `resident:${resident_id}`, {}, () => {
    store.db.prepare("UPDATE enrol_codes SET used_at = ? WHERE code_hash = ?").run(at, codeHash);
    store.db.prepare("INSERT INTO residents (id, token_hash, code_hash, created_at) VALUES (?, ?, ?, ?)").run(resident_id, sha256(token), codeHash, at);
  });
  return { token, resident_id };
}

export function residentFromToken(store: Store, token: string | null): { id: string; created_at: string } | null {
  if (!token) return null;
  const row = store.db.prepare("SELECT id, created_at FROM residents WHERE token_hash = ?").get(sha256(token)) as { id: string; created_at: string } | undefined;
  return row ?? null;
}

export class DeskError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
