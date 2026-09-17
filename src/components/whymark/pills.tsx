"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Risk, SourceRef, VerifyClaim, VerifyStatus } from "@/lib/whymark/types";
import { SOURCE_META, STATUS_COLOR, STATUS_LABEL, VERIFY_META } from "./meta";
import { inline } from "./markdown";

export function StatusDot({ status, className }: { status: VerifyStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: STATUS_COLOR[status] }}
    />
  );
}

export function RiskPill({ risk }: { risk: Risk }) {
  const tone =
    risk === "high"
      ? "var(--whymark-fail)"
      : risk === "medium"
        ? "var(--whymark-unknown)"
        : "var(--muted-foreground)";
  return (
    <span
      className="rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide"
      style={{
        color: tone,
        backgroundColor: `color-mix(in oklch, ${tone} 16%, transparent)`,
      }}
      title={`Blast radius if this is wrong: ${risk}`}
    >
      {risk} risk
    </span>
  );
}

export function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.8
      ? "var(--whymark-pass)"
      : value >= 0.5
        ? "var(--whymark-unknown)"
        : "var(--whymark-fail)";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground"
      title={`The author's stated confidence: ${pct}%`}
    >
      <span className="flex gap-px" aria-hidden>
        {[0, 1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className="h-2.5 w-[3px] rounded-sm"
            style={{
              backgroundColor:
                step < Math.round(value * 5) ? tone : "color-mix(in oklch, var(--foreground) 12%, transparent)",
            }}
          />
        ))}
      </span>
      {pct}% confidence
    </span>
  );
}

export function SourceRow({ source }: { source: SourceRef }) {
  const meta = SOURCE_META[source.type] ?? SOURCE_META.other;
  const Icon = meta.icon;
  const isInference = source.type === "inference";
  const href = /^https?:\/\//.test(source.locator) ? source.locator : null;

  return (
    <li
      className={cn(
        "flex gap-2 rounded-md px-2 py-1.5 text-[12px] leading-snug",
        isInference
          ? "bg-[color-mix(in_oklch,var(--whymark-inference)_12%,transparent)]"
          : "bg-foreground/[0.035]",
      )}
    >
      <Icon
        className="mt-[3px] size-3 shrink-0"
        style={{ color: isInference ? "var(--whymark-inference)" : "var(--kind-source)" }}
      />
      <div className="min-w-0 flex-1">
        {isInference ? (
          <div className="font-medium text-[color:var(--whymark-inference)]">
            no external source — inferred
          </div>
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all font-mono text-[11.5px] text-foreground/90 underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {source.locator.replace(/^https?:\/\//, "")}
            <ExternalLink className="size-2.5 shrink-0" />
          </a>
        ) : (
          <span className="break-all font-mono text-[11.5px] text-foreground/90">
            {source.locator || meta.label}
          </span>
        )}
        {source.note ? (
          <div className="mt-0.5 text-muted-foreground">{inline(source.note)}</div>
        ) : null}
      </div>
    </li>
  );
}

export function VerifyRow({ claim }: { claim: VerifyClaim }) {
  const meta = VERIFY_META[claim.method] ?? VERIFY_META.manual;
  const Icon = meta.icon;
  const color = STATUS_COLOR[claim.status];

  return (
    <li className="flex gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5 text-[12px] leading-snug">
      <Icon className="mt-[3px] size-3 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span
            className="text-[10px] font-medium uppercase tracking-wide"
            style={{ color }}
          >
            {claim.method === "none" ? STATUS_LABEL[claim.status] : `claimed ${STATUS_LABEL[claim.status]}`}
          </span>
          <span className="text-[10px] text-muted-foreground">{meta.label}</span>
        </div>
        {claim.detail ? (
          claim.method === "cmd" ? (
            <code className="mt-0.5 block break-all font-mono text-[11.5px] text-foreground/90">
              $ {claim.detail}
            </code>
          ) : (
            <div className="mt-0.5 text-foreground/90">{inline(claim.detail)}</div>
          )
        ) : null}
        {claim.comment ? (
          <div className="mt-0.5 text-muted-foreground">{inline(claim.comment)}</div>
        ) : null}
      </div>
    </li>
  );
}
