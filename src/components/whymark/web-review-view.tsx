"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReviewView, type ReviewViewProps } from "./review-view";
import { applyFileDecisions, saveEditedRange } from "@/app/r/[slug]/actions";
export function WebReviewView(props: ReviewViewProps) {
  return <ReviewView {...props} homeControl={<Link href="/" aria-label="Home" className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /></Link>} actions={{ applyFileDecisions, saveEditedRange }} />;
}
