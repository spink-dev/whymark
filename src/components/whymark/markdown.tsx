import type { ReactNode } from "react";

/**
 * Just enough markdown for annotation bodies and the format reference:
 * headings, paragraphs, lists, fenced code, tables, quotes, and inline
 * emphasis/code/links. Deliberately not a general renderer.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(
        <pre
          key={key++}
          className="whymark-scroll my-3 overflow-x-auto rounded-lg border border-border/60 bg-black/30 p-3 text-[12px] leading-relaxed"
        >
          <code data-lang={lang}>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const sizes = [
        "text-2xl font-semibold tracking-tight mt-8 mb-3",
        "text-xl font-semibold tracking-tight mt-7 mb-3",
        "text-base font-semibold tracking-tight mt-6 mb-2",
        "text-sm font-semibold mt-5 mb-2",
        "text-sm font-medium mt-4 mb-1",
        "text-xs font-medium uppercase tracking-wide mt-4 mb-1",
      ];
      const Tag = `h${Math.min(level, 6)}` as "h1";
      out.push(
        <Tag key={key++} className={sizes[level - 1]}>
          {inline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
      out.push(<hr key={key++} className="my-6 border-border/60" />);
      i++;
      continue;
    }

    if (line.trimStart().startsWith("|") && lines[i + 1]?.includes("---")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={key++} className="whymark-scroll my-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {head?.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-border/70 px-2 py-1.5 text-left font-medium text-muted-foreground"
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-b border-border/30 px-2 py-1.5">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote
          key={key++}
          className="my-3 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderBlocks(body.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    const bullet = /^\s*([-*+]|\d+\.)\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!item) {
          // continuation of the previous bullet
          if (/^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        items.push(item[1]);
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List
          key={key++}
          className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground/60`}
        >
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    out.push(
      <p key={key++} className="my-2 leading-relaxed">
        {inline(paragraph.join(" "))}
      </p>,
    );
  }

  return out;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith("```") ||
    /^#{1,6}\s/.test(line) ||
    /^\s*([-*+]|\d+\.)\s/.test(line) ||
    /^\s*>/.test(line) ||
    line.trimStart().startsWith("|")
  );
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g;

export function inline(text: string): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== undefined && part !== "");
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code
          key={index}
          className="rounded bg-foreground/10 px-1 py-px font-mono text-[0.92em] text-foreground/90"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (
      (part.startsWith("*") && part.endsWith("*") && part.length > 2) ||
      (part.startsWith("_") && part.endsWith("_") && part.length > 2)
    ) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={index}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[color:var(--kind-source)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {link[1]}
        </a>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="break-all text-[color:var(--kind-source)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {part.replace(/^https?:\/\//, "")}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}
