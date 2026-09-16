import type { MetadataRoute } from "next";
import { listReviews } from "@/lib/reviews";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const reviews = await listReviews();
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now },
    { url: `${SITE_URL}/format`, lastModified: now },
    { url: `${SITE_URL}/terms`, lastModified: now },
    { url: `${SITE_URL}/privacy`, lastModified: now },
    ...reviews.map((review) => ({
      url: `${SITE_URL}/r/${review.slug}`,
      lastModified: review.doc.meta.date ? new Date(review.doc.meta.date) : now,
    })),
  ];
}
