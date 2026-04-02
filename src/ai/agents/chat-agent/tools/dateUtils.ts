/**
 * Safely parse an ISO date string (YYYY-MM-DD) into a local Date object.
 *
 * `new Date("2026-02-01")` creates a UTC midnight date, which shifts to the
 * previous day in negative-offset timezones (e.g. Americas). This helper
 * splits the string and constructs a local date to avoid that pitfall.
 *
 * Returns null if the string is not a valid date.
 */
export function parseISODateLocal(isoDate: string): Date | null {
  const parts = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const date = new Date(
    parseInt(parts[1], 10),
    parseInt(parts[2], 10) - 1,
    parseInt(parts[3], 10),
  );
  if (isNaN(date.getTime())) return null;
  return date;
}
