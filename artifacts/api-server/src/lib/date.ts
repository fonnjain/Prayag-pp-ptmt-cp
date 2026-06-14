const pad = (n: number) => String(n).padStart(2, "0");

// Project-wide display format is dd-mm-yyyy.
export function formatDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// dd-mm-yyyy HH:mm (24h).
export function formatDateTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
