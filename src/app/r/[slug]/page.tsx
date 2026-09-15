import { notFound } from "next/navigation";
import { loadReview, listReviews } from "@/lib/reviews";
import { validateDocument } from "@/lib/crev/validate";
import { buildReviewVM } from "@/lib/view-model";
import { ReviewView } from "@/components/crev/review-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const review = await loadReview(slug);
  if (!review) return { title: "Review not found" };
  return {
    title: `${review.doc.meta.title} — crev`,
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

  const [vm, validation] = await Promise.all([
    buildReviewVM(review.doc),
    Promise.resolve(validateDocument(review.doc, { cwd: process.cwd() })),
  ]);

  return <ReviewView review={vm} slug={review.slug} issues={validation.diagnostics} />;
}
