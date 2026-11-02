import type { RawLocation } from "@ksp/shared";

export type SourcePage = {
  records: RawLocation[];
  /** Opaque cursor for the next page; null when exhausted. */
  nextCursor: string | null;
  pageNumber: number;
};

export type SourceAdapter = {
  readonly key: string;
  fetchPage(cursor: string | null, pageSize: number): Promise<SourcePage>;
};

export type SourceFaultMode = "none" | "timeout" | "rate_limit" | "malformed_json";
