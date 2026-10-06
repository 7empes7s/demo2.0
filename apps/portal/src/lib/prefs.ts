/** Per-device conveniences and the session token. Storage can be missing or blocked, so every access is guarded. */

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Private windows and sandboxed previews refuse storage; the portal works without it.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

export const prefs = {
  lang: () => read(local, "d2.portal.lang"),
  setLang: (lang: string) => write(local, "d2.portal.lang", lang),
  theme: () => read(local, "d2.portal.theme") as "light" | "dark" | null,
  setTheme: (theme: "light" | "dark" | null) => write(local, "d2.portal.theme", theme),
  /** The staff token lives for the tab only. */
  token: () => read(session, "d2.portal.token"),
  setToken: (token: string | null) => write(session, "d2.portal.token", token),
  staff: () => read(session, "d2.portal.staff"),
  setStaff: (json: string | null) => write(session, "d2.portal.staff", json),
};
