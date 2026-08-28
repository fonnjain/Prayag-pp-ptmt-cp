import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  if (typeof dateStr === "string") {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  }
  const parsed = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return String(dateStr);
  return `${String(parsed.getDate()).padStart(2, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${parsed.getFullYear()}`;
}
