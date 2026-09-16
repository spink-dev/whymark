/** Public origin of the hosted viewer. */
export const SITE_HOST = "whymark.x47.dev";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:43917"
    : `https://${SITE_HOST}`);

/** The hosted deployment cannot write a working tree. */
export function canWriteWorkingTree(): boolean {
  return !process.env.VERCEL;
}
