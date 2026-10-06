/** Who is signed in, and which sections that person may open. */

import { post, whenUnauthorized } from "./api.ts";
import { prefs } from "./prefs.ts";
import type { Role, Staff } from "./types.ts";

export const session = $state<{ staff: Staff | null }>({ staff: readSaved() });

function readSaved(): Staff | null {
  const raw = prefs.staff();
  if (!raw || !prefs.token()) return null;
  try {
    const s = JSON.parse(raw) as Staff;
    return s && typeof s.id === "string" && typeof s.role === "string" ? s : null;
  } catch {
    return null;
  }
}

export async function signIn(login: string, password: string): Promise<Staff> {
  const out = await post<{ token: string; staff: Staff }>("/staff/login", { login, password });
  prefs.setToken(out.token);
  prefs.setStaff(JSON.stringify(out.staff));
  session.staff = out.staff;
  return out.staff;
}

/** Forgets the session here, and tells Desk when it can. */
export async function signOut() {
  const hadToken = !!prefs.token();
  forget();
  if (hadToken) {
    try {
      await post("/staff/logout");
    } catch {
      // The token is gone from this tab either way.
    }
  }
}

export function forget() {
  prefs.setToken(null);
  prefs.setStaff(null);
  session.staff = null;
}

whenUnauthorized(forget);

/** The portal's sections, and the roles that see each. An admin sees everything. */
export const SECTIONS = {
  inbox: ["operator", "admin"],
  ideas: ["operator", "admin"],
  procedures: ["operator", "admin"],
  votes: ["operator", "admin"],
  staff: ["admin"],
  codes: ["admin"],
  settings: ["admin"],
  audit: ["auditor", "admin"],
  "audit-votes": ["auditor", "admin"],
  "audit-model": ["auditor", "admin"],
  "audit-summary": ["auditor", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Section = keyof typeof SECTIONS;

export function canOpen(role: Role | undefined, section: Section): boolean {
  return !!role && (SECTIONS[section] as readonly Role[]).includes(role);
}

/** The first section a person of this role lands on. */
export function homeOf(role: Role): Section {
  return role === "auditor" ? "audit" : "inbox";
}
