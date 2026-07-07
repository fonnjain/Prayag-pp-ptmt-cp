import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Cocks Standard",
  "Cocks Premium",
  "Faucets & Jetsprays & Shower",
  "Accessorise",
  "Cistern & Seat Cover",
  "Cabinet",
  "Ball Cock",
];

export function categorySlug(name: string): string {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"));
}

const NAV_LINKS = [
  { href: "/", label: "Data" },
  { href: "/summary", label: "Summary" },
  ...CATEGORIES.map((c) => ({ href: `/category/${categorySlug(c)}`, label: c })),
  { href: "/runs", label: "Plan Runs" },
  { href: "/export", label: "Export" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen w-full bg-gray-50">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="px-4 py-3">
          <h1 className="text-lg font-semibold text-gray-900">PTMT Daily Production Planning</h1>
        </div>
        <nav className="flex flex-wrap gap-1 px-4 pb-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md whitespace-nowrap",
                location === link.href
                  ? "bg-primary text-primary-foreground"
                  : "text-gray-600 hover:bg-gray-100",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}

export { CATEGORIES };
