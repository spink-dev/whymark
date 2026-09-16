/**
 * A worked example, kept in the repo so the reviewer in `whymark` has something
 * real to act on. The review at `reviews/retry-backoff.whymark` describes a
 * change to this file, and because the file is really here, you can discard
 * parts of that change or edit them from the review page.
 *
 * `git checkout examples/` puts it back.
 */

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  /** Cap on any single wait, so a long backoff cannot stall a request forever. */
  maxDelayMs?: number;
}

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: number }).status;
  return status === 429 || status === 503 || status === 502 || status === 504;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Full jitter: every client picks its own wait inside the window. */
function backoff(attempt: number, base: number, cap: number): number {
  const window = Math.min(cap, base * 2 ** (attempt - 1));
  return Math.random() * window;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.delayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;
      const wait = backoff(attempt, baseDelayMs, maxDelayMs);
      console.log(`[retry] attempt ${attempt} failed, waiting ${wait}ms`);
      await sleep(wait);
    }
  }

  throw lastError;
}
