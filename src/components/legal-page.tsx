import type { ReactNode } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[13.5px] leading-relaxed text-foreground/90">
        <p className="font-mono text-[12px] text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            home
          </Link>
          {" / "}
          {title.toLowerCase()}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Last updated {updated}</p>
        <div className="legal-prose mt-8 space-y-4 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-[0.92em]">
          {children}
        </div>
      </article>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="pt-2 text-[15px] font-medium">{title}</h2>
      {children}
    </section>
  );
}
