import { cn } from "@/lib/utils";

function tone(value: number): string {
  if (value >= 0.8) return "var(--whymark-pass)";
  if (value >= 0.5) return "var(--whymark-unknown)";
  return "var(--whymark-fail)";
}

export function CoverageBar({
  value,
  width = 96,
  label,
  className,
}: {
  value: number;
  width?: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={label ?? `${pct}% of added lines annotated`}
    >
      <span
        className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
        style={{ width }}
      >
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: tone(value) }}
        />
      </span>
      <span
        className="text-[11px] tabular-nums"
        style={{ color: tone(value) }}
      >
        {pct}%
      </span>
    </span>
  );
}

export function Ring({
  value,
  size = 34,
  stroke = 3,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-foreground/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={tone(value)}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value)}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <span className="absolute text-[9px] font-medium tabular-nums text-muted-foreground">
        {children ?? `${Math.round(value * 100)}`}
      </span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className="truncate text-[13px] font-medium tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
