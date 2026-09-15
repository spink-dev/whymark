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
}

/** Retryable, in this codebase, means the call is safe to send again. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: number }).status;
  return status === 429 || status === 503;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 200;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;
      await sleep(delayMs);
    }
  }

  throw lastError;
}
