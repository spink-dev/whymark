import { listReviews } from "@/lib/reviews";
import { SAMPLE_WHYMARK } from "@/lib/sample-review";
import { HomeClient } from "./home-client";

export default async function Home() {
  const reviews = await listReviews();
  return (
    <HomeClient
      sample={SAMPLE_WHYMARK}
      examples={reviews.map((review) => ({
        slug: review.slug,
        title: review.doc.meta.title,
        summary: review.doc.meta.summary?.replace(/\s+/g, " ").trim(),
      }))}
    />
  );
}
