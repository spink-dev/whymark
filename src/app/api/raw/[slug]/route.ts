import { loadRawReview } from "@/lib/reviews";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const text = await loadRawReview(slug);
  if (text === null) {
    return new Response("Not found\n", { status: 404 });
  }
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
