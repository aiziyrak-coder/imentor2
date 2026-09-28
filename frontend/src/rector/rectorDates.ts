/** All report presets use the same calendar as the backend: Asia/Tashkent. */
function localCalendar(now = new Date()) {
  return new Date(now.getTime() + 5 * 3600_000);
}
export function shiftDays(days: number, now = new Date()): string {
  const d = localCalendar(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function monthStart(offset = 0, now = new Date()): string {
  const d = localCalendar(now);
  d.setUTCMonth(d.getUTCMonth() + offset, 1);
  return d.toISOString().slice(0, 10);
}
export function monthEnd(offset = 0, now = new Date()): string {
  const d = localCalendar(now);
  d.setUTCMonth(d.getUTCMonth() + offset + 1, 0);
  return d.toISOString().slice(0, 10);
}
