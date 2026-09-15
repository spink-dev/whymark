import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Markdown } from "@/components/crev/markdown";

export const metadata = {
  title: "CREV v1 format — crev",
};

export const dynamic = "force-dynamic";

export default async function FormatPage() {
  let spec: string;
  try {
    spec = await readFile(join(process.cwd(), "spec", "crev-v1.md"), "utf8");
  } catch {
    spec = "# Specification missing\n\nExpected to find `spec/crev-v1.md` in this repository.";
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label="All reviews"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <span className="font-mono text-[12px] text-muted-foreground">spec/crev-v1.md</span>
      </header>
      <Markdown
        text={spec}
        className="text-[13.5px] text-foreground/90 [&_code]:text-[0.92em] [&>h1]:mt-0"
      />
    </div>
  );
}
