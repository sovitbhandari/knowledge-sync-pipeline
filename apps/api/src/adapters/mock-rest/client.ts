import { rawLocationSchema, type RawLocation } from "@ksp/shared";
import { z } from "zod";
import type { SourceAdapter, SourcePage } from "../types.js";

const pageResponseSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  page_number: z.number().int().positive(),
});

export class SourceHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { status: number; retryAfterSeconds?: number | null; retryable: boolean },
  ) {
    super(message);
    this.name = "SourceHttpError";
    this.status = opts.status;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.retryable = opts.retryable;
  }
}

export class SourceTimeoutError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "SourceTimeoutError";
  }
}

export type MockRestAdapterOptions = {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class MockRestAdapter implements SourceAdapter {
  readonly key = "mock-rest";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: MockRestAdapterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 3_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async fetchPage(cursor: string | null, pageSize: number): Promise<SourcePage> {
    const url = new URL(`${this.baseUrl}/locations`);
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SourceTimeoutError(`Mock REST request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      throw new SourceHttpError("Mock REST rate limited", {
        status: 429,
        retryAfterSeconds: retryAfter,
        retryable: true,
      });
    }

    if (response.status >= 500) {
      throw new SourceHttpError(`Mock REST upstream error ${response.status}`, {
        status: response.status,
        retryable: true,
      });
    }

    if (!response.ok) {
      throw new SourceHttpError(`Mock REST permanent error ${response.status}`, {
        status: response.status,
        retryable: false,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new SourceHttpError("Mock REST returned malformed JSON", {
        status: response.status,
        retryable: false,
      });
    }

    const parsed = pageResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new SourceHttpError("Mock REST response failed schema validation", {
        status: response.status,
        retryable: false,
      });
    }

    const records: RawLocation[] = [];
    for (const item of parsed.data.data) {
      const record = rawLocationSchema.safeParse(item);
      if (!record.success) {
        // Keep raw-shaped object for downstream rejection auditing when possible.
        records.push(item as RawLocation);
        continue;
      }
      records.push(record.data);
    }

    return {
      records,
      nextCursor: parsed.data.next_cursor,
      pageNumber: parsed.data.page_number,
    };
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const seconds = Math.ceil((date - Date.now()) / 1000);
    return seconds > 0 ? seconds : 0;
  }
  return null;
}
