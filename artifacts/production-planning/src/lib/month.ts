export function currentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, (m ?? 1) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
