/**
 * Returns the current time in IST (UTC+5:30) formatted as YYYYMMDD-HHmm,
 * suitable for embedding in download filenames.
 *
 * Example: "20260817-1430"
 */
export function exportTimestamp(): string {
  const now = new Date();
  // Shift to IST = UTC + 5h30m
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  const y  = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(ist.getUTCDate()).padStart(2, "0");
  const h  = String(ist.getUTCHours()).padStart(2, "0");
  const mi = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}-${h}${mi}`;
}
