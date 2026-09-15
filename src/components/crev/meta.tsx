import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  BookOpen,
  BookOpenCheck,
  Braces,
  CircleDot,
  CircleSlash,
  Compass,
  Eye,
  FileCode,
  FlaskConical,
  Gauge,
  GitCommitHorizontal,
  GitPullRequest,
  Globe,
  Link,
  ListTodo,
  MessageSquareQuote,
  MessagesSquare,
  Package,
  Ruler,
  ScrollText,
  ShieldAlert,
  Shuffle,
  Sparkles,
  StickyNote,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NoteKind, SourceType, VerifyMethod, VerifyStatus } from "@/lib/crev/types";

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** CSS custom property holding the accent colour. */
  color: string;
  hint: string;
}

export const KIND_META: Record<NoteKind, KindMeta> = {
  intent: {
    label: "intent",
    icon: Compass,
    color: "var(--kind-intent)",
    hint: "Why this code exists",
  },
  source: {
    label: "source",
    icon: BookOpen,
    color: "var(--kind-source)",
    hint: "Where the approach came from",
  },
  verify: {
    label: "verify",
    icon: BadgeCheck,
    color: "var(--kind-verify)",
    hint: "Evidence that it works",
  },
  risk: {
    label: "risk",
    icon: AlertTriangle,
    color: "var(--kind-risk)",
    hint: "A known hazard",
  },
  assumption: {
    label: "assumption",
    icon: Eye,
    color: "var(--kind-assumption)",
    hint: "Taken on faith — confirm it",
  },
  alternative: {
    label: "alternative",
    icon: Shuffle,
    color: "var(--kind-alternative)",
    hint: "Considered and rejected",
  },
  todo: {
    label: "todo",
    icon: ListTodo,
    color: "var(--kind-todo)",
    hint: "Deliberately unfinished",
  },
  question: {
    label: "question",
    icon: MessagesSquare,
    color: "var(--kind-question)",
    hint: "Needs a decision from you",
  },
  security: {
    label: "security",
    icon: ShieldAlert,
    color: "var(--kind-security)",
    hint: "Authz, injection, or secrets",
  },
  perf: {
    label: "perf",
    icon: Gauge,
    color: "var(--kind-perf)",
    hint: "Cost or complexity consequence",
  },
  test: {
    label: "test",
    icon: FlaskConical,
    color: "var(--kind-test)",
    hint: "What is covered, and what is not",
  },
  generated: {
    label: "generated",
    icon: Bot,
    color: "var(--kind-generated)",
    hint: "Mechanical output, not reasoned about",
  },
  note: {
    label: "note",
    icon: StickyNote,
    color: "var(--kind-note)",
    hint: "Everything else",
  },
};

export const SOURCE_META: Record<SourceType, { icon: LucideIcon; label: string }> = {
  file: { icon: FileCode, label: "file" },
  url: { icon: Globe, label: "link" },
  doc: { icon: BookOpen, label: "docs" },
  spec: { icon: ScrollText, label: "spec" },
  commit: { icon: GitCommitHorizontal, label: "commit" },
  pr: { icon: GitPullRequest, label: "pr" },
  issue: { icon: CircleDot, label: "issue" },
  test: { icon: FlaskConical, label: "test" },
  dep: { icon: Package, label: "dependency" },
  convention: { icon: Ruler, label: "convention" },
  prompt: { icon: MessageSquareQuote, label: "your prompt" },
  inference: { icon: Sparkles, label: "inference" },
  other: { icon: Link, label: "source" },
};

export const VERIFY_META: Record<VerifyMethod, { icon: LucideIcon; label: string }> = {
  cmd: { icon: Terminal, label: "command" },
  test: { icon: FlaskConical, label: "test" },
  type: { icon: Braces, label: "types" },
  lint: { icon: Ruler, label: "lint" },
  manual: { icon: Eye, label: "checked by hand" },
  review: { icon: BookOpenCheck, label: "read only" },
  none: { icon: CircleSlash, label: "not verified" },
};

export const STATUS_COLOR: Record<VerifyStatus, string> = {
  pass: "var(--crev-pass)",
  fail: "var(--crev-fail)",
  unknown: "var(--crev-unknown)",
  skipped: "var(--muted-foreground)",
};

export const STATUS_LABEL: Record<VerifyStatus, string> = {
  pass: "passed",
  fail: "failed",
  unknown: "unverified",
  skipped: "skipped",
};
