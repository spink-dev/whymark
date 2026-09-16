import Link from "next/link";
import { SITE_HOST } from "@/lib/site";

const links = [
  { href: "/format", label: "format" },
  { href: "/terms", label: "terms" },
  { href: "/privacy", label: "privacy" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-border/70">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[13px] font-semibold text-background">
            whymark
          </span>
          <span className="hidden font-mono text-[12px] text-muted-foreground sm:inline">
            {SITE_HOST}
          </span>
        </Link>
        <nav className="flex gap-1 text-[12.5px]">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-4 text-[11.5px] text-muted-foreground">
        <p>Reviews stay in this browser. Nothing is uploaded or stored on a server.</p>
        <p className="flex gap-3">
          <Link href="/terms" className="hover:text-foreground">
            Terms of Use
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </p>
      </div>
    </footer>
  );
}
