export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injected sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected RNG in [0, 1) for jitter. */
  random?: () => number;
  now?: () => number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void | Promise<void>;
};

export type RetryableLike = {
  retryable?: boolean;
  retryAfterSeconds?: number | null;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as RetryableLike & { name?: string };
  if (candidate.retryable === false) return false;
  if (candidate.retryable === true) return true;
  return candidate.name === "SourceTimeoutError";
}

export function computeBackoffDelayMs(
  attempt: number,
  opts: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "random">,
  retryAfterSeconds?: number | null,
): number {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(opts.maxDelayMs, Math.ceil(retryAfterSeconds * 1000));
  }

  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const random = opts.random ?? Math.random;
  // Full jitter: [0, exp]
  return Math.floor(random() * (exp + 1));
}

export async function withRetries<T>(
  operation: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (!isRetryableError(error) || attempt > opts.maxRetries) {
        throw error;
      }

      const retryAfter =
        error && typeof error === "object"
          ? ((error as RetryableLike).retryAfterSeconds ?? null)
          : null;
      const delayMs = computeBackoffDelayMs(attempt, opts, retryAfter);
      await opts.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
