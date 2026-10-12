// Timezone helpers — no external deps. All conversions go through Intl so DST is handled correctly.

export const FALLBACK_ZONES = [
  "UTC", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Africa/Johannesburg", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "America/Mexico_City",
];

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

let _zones: string[] | null = null;
export function getTimeZones(): string[] {
  if (_zones) return _zones;
  try {
    const anyIntl = Intl as any;
    const list: string[] = typeof anyIntl.supportedValuesOf === "function" ? anyIntl.supportedValuesOf("timeZone") : [];
    _zones = list.length ? (list.includes("UTC") ? list : ["UTC", ...list]) : FALLBACK_ZONES;
  } catch {
    _zones = FALLBACK_ZONES;
  }
  return _zones;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (minutes east of UTC) of `tz` at the instant `utcMs`. */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Convert a wall-clock "YYYY-MM-DDTHH:mm" in `tz` to the real instant. Returns null if unparsable. */
export function zonedWallToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || "");
  if (!m || !isValidTimeZone(tz)) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let result = guess - tzOffsetMinutes(guess, tz) * 60000;
  // second pass fixes the case where the offset differs at the corrected instant (DST edges)
  result = guess - tzOffsetMinutes(result, tz) * 60000;
  return new Date(result);
}

/** Format an instant in a zone, e.g. "Mon, Oct 12, 7:30 PM". */
export function formatInZone(d: Date | string | number, tz: string, opts?: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...opts,
    }).format(new Date(d));
  } catch {
    return String(d);
  }
}

/** "GMT+5:30" style label for a zone right now. */
export function gmtLabel(tz: string, at: Date = new Date()): string {
  const off = tzOffsetMinutes(at.getTime(), tz);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60), mm = abs % 60;
  return `GMT${sign}${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}`;
}

/** Instant -> "YYYY-MM-DDTHH:mm" wall-clock in `tz` (value for <input type="datetime-local">). */
export function toZonedInput(d: Date | string | number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(d));
  const g = (t: string) => parts.find(p => p.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** Friendly relative label: "in 2h 10m", "3h overdue", "in 4 days". */
export function relativeTime(target: Date | string, now: Date = new Date()): string {
  const diff = new Date(target).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  let txt: string;
  if (mins < 1) txt = "now";
  else if (mins < 60) txt = `${mins}m`;
  else if (mins < 60 * 24) { const h = Math.floor(mins / 60), m = mins % 60; txt = m && h < 6 ? `${h}h ${m}m` : `${h}h`; }
  else { const d = Math.round(mins / (60 * 24)); txt = `${d} day${d === 1 ? "" : "s"}`; }
  if (txt === "now") return "now";
  return diff >= 0 ? `in ${txt}` : `${txt} overdue`;
}
