import { localEvidence, sourceFingerprint, reviewFingerprint } from "@/lib/whymark/evidence-node";
import { notFound } from "next/navigation";
import { loadReview, listReviews } from "@/lib/reviews";
import { validateDocumentInRepo } from "@/lib/whymark/validate-tree";
import { isActionable } from "@/lib/whymark/edit";
import { hashObject } from "@/lib/whymark/git";
import { buildReviewVM } from "@/lib/view-model";
import { ReviewView } from "@/components/whymark/review-view";
import { canWriteWorkingTree } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const review = await loadReview(slug);
  if (!review) return { title: "Review not found" };
  return {
    title: `${review.doc.meta.title} — whymark`,
    description: review.doc.meta.summary?.slice(0, 180),
  };
}

export async function generateStaticParams() {
  const reviews = await listReviews();
  return reviews.map((review) => ({ slug: review.slug }));
}

export default async function ReviewPage({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const review = await loadReview(slug);
  if (!review) notFound();

  const writable = canWriteWorkingTree();
  const [vm, validation] = await Promise.all([
    buildReviewVM(review.doc, {
      source: writable ? sourceFingerprint(process.cwd()) : undefined,
      reviewHash: reviewFingerprint(review.doc),
      evidence: writable ? localEvidence(review.doc, process.cwd()) : undefined,
      isWritable: writable
        ? (file) => isActionable(file, hashObject(file.path, process.cwd()))
        : undefined,
    }),
    Promise.resolve(
      validateDocumentInRepo(review.doc, {
        cwd: process.cwd(),
        skipStaleness: !writable,
      }),
    ),
  ]);

  return <ReviewView review={vm} slug={review.slug} issues={validation.diagnostics} />;
}
