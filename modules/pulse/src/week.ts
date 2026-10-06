/**
 * The week window. A Pulse week is an ISO 8601 week (Monday to Sunday) on the Luxembourg
 * calendar: "now" is first turned into the date in Europe/Luxembourg, so Sunday 23:30 UTC in
 * summer is already Monday in Luxembourg. Dates are compared as YYYY-MM-DD strings.
 */

export const TIME_ZONE = "Europe/Luxembourg";

export interface Week {
  /** ISO week id, e.g. "2026-W41". The year is the ISO week-numbering year. */
  id: string;
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Sunday, YYYY-MM-DD. */
  end: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86_400_000;

/** The calendar date in Luxembourg at `now`, as YYYY-MM-DD. */
export function luxembourgDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parse(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new RangeError(`no such date: ${date}`);
  return ms;
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The ISO week that contains the calendar date `date` (YYYY-MM-DD). */
export function isoWeek(date: string): Week {
  const ms = parse(date);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday 0 .. Sunday 6
  const monday = ms - weekday * DAY;
  // The week belongs to the year of its Thursday.
  const thursday = new Date(monday + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const number = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return { id: `${year}-W${String(number).padStart(2, "0")}`, start: fmt(monday), end: fmt(monday + 6 * DAY) };
}

/** The Pulse week at the instant `now`. */
export const weekAt = (now: Date): Week => isoWeek(luxembourgDate(now));

/**
 * The calendar day of a date or timestamp from the public list: "2026-10-08" stays as is, a
 * timestamp with a time zone is read on the Luxembourg calendar, anything else is null.
 */
export function dayOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (DATE.test(text)) {
    try {
      parse(text);
      return text;
    } catch {
      return null;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) return null;
    // A timestamp without an offset is already local time: keep its date part.
    return /(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? luxembourgDate(new Date(ms)) : dayOf(text.slice(0, 10));
  }
  return null;
}

export const inWeek = (day: string, week: Week): boolean => day >= week.start && day <= week.end;
