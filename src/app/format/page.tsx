import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Markdown } from "@/components/whymark/markdown";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const metadata = {
  title: "whymark v1 format — whymark",
};

export default async function FormatPage() {
  let spec: string;
  try {
    spec = await readFile(join(process.cwd(), "spec", "whymark-v1.md"), "utf8");
  } catch {
    spec = "# Specification missing\n\nExpected to find `spec/whymark-v1.md` in this repository.";
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-3xl px-5 py-8">
        <p className="mb-6 font-mono text-[12px] text-muted-foreground">spec/whymark-v1.md</p>
        <Markdown
          text={spec}
          className="text-[13.5px] text-foreground/90 [&_code]:text-[0.92em] [&>h1]:mt-0"
        />
      </div>
      <SiteFooter />
    </div>
  );
}
