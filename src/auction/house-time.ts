// R-12 (D-84): the house's IANA zone is for printing times and reading typed ones. Storage, the engine and the countdown
// stay UTC / epoch ms. Intl only; nothing here reads a clock.

export const isTimeZone = (tz: string): boolean => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

type Parts = Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'timeZoneName', string>;
const parts = (ms: number, tz: string): Parts => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value])) as Parts;
};

/** A printed time: `2031-01-01 12:00 EST`. The zone is always named (R-12); short names fall back to `GMT+1` where a zone has none. */
export function inZone(at: Date | number, tz: string): string {
  const p = parts(+at, tz);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

/** The wall-clock `YYYY-MM-DDTHH:MM` of an instant in the zone: a datetime-local field's value. */
export function toLocalInput(at: Date | number, tz: string): string {
  const p = parts(+at, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const wallMs = (p: Parts) => Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);

/** The instant a typed `YYYY-MM-DDTHH:MM` names in the zone, or null when malformed. Two passes settle the offset; at a
 * DST gap the typed time does not exist and the later offset's reading is taken, at an overlap the first (earlier) one. */
export function fromLocalInput(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const offsetAt = (ms: number) => wallMs(parts(ms, tz)) - ms;
  const first = wall - offsetAt(wall);
  const second = wall - offsetAt(first);
  // second renders back to the typed time in every ordinary case and at an overlap (the first instant); only in a gap does
  // nothing render to it, and then the later of the two readings is the forward one (02:30 in a 02:00→03:00 gap reads 03:30)
  return new Date(wallMs(parts(second, tz)) === wall ? second : Math.max(first, second));
}
