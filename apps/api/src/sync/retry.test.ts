import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelayMs, withRetries } from "./retry.js";

describe("retry helpers", () => {
  it("uses Retry-After seconds when provided", () => {
    const delay = computeBackoffDelayMs(
      1,
      { baseDelayMs: 200, maxDelayMs: 10_000, random: () => 0.5 },
      2,
    );
    expect(delay).toBe(2000);
  });

  it("retries retryable errors with bounded attempts", async () => {
    let calls = 0;
    const sleep = vi.fn(async () => undefined);
    const result = await withRetries(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("transient"), { retryable: true });
        }
        return "ok";
      },
      {
        maxRetries: 5,
        baseDelayMs: 10,
        maxDelayMs: 100,
        sleep,
        random: () => 0,
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent errors", async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls += 1;
          throw Object.assign(new Error("nope"), { retryable: false });
        },
        {
          maxRetries: 5,
          baseDelayMs: 10,
          maxDelayMs: 100,
          sleep: async () => undefined,
        },
      ),
    ).rejects.toThrow("nope");
    expect(calls).toBe(1);
  });
});
