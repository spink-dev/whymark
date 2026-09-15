import { describe, expect, it, vi } from "vitest";
import { isRetryable, withRetry } from "../examples/retry";

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("isRetryable", () => {
  it("retries the statuses that mean try again", () => {
    for (const status of [429, 503, 502, 504]) {
      expect(isRetryable(httpError(status))).toBe(true);
    }
  });

  it("does not retry a client mistake", () => {
    for (const status of [400, 401, 404, 422]) {
      expect(isRetryable(httpError(status))).toBe(false);
    }
    expect(isRetryable("not an error")).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("keeps trying a retryable failure up to the attempt limit", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue("ok");
    await expect(withRetry(operation, { delayMs: 0 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last attempt and throws what failed", async () => {
    const operation = vi.fn().mockRejectedValue(httpError(429));
    await expect(withRetry(operation, { attempts: 2, delayMs: 0 })).rejects.toThrow(
      "HTTP 429",
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error that will fail the same way again", async () => {
    const operation = vi.fn().mockRejectedValue(httpError(400));
    await expect(withRetry(operation, { delayMs: 0 })).rejects.toThrow("HTTP 400");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("waits inside the jittered window and never past the cap", async () => {
    const waits: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const operation = vi.fn().mockRejectedValue(httpError(503));
    await expect(
      withRetry(operation, { attempts: 6, delayMs: 100, maxDelayMs: 400 }),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    // Six attempts means five waits, with windows of 100, 200, 400 and then the cap.
    expect(waits).toHaveLength(5);
    expect(waits[0]).toBeLessThanOrEqual(100);
    expect(waits[1]).toBeLessThanOrEqual(200);
    for (const wait of waits) {
      expect(wait).toBeGreaterThanOrEqual(0);
      expect(wait).toBeLessThanOrEqual(400);
    }
  });
});
