import type { RawLocation } from "@ksp/shared";
import { buildMockLocations } from "./fixtures.js";
import type { SourceFaultMode } from "../types.js";

export type MockSourceConfig = {
  totalRecords: number;
  defaultPageSize: number;
  faultMode: SourceFaultMode;
  /**
   * How many times to apply faultMode before returning to healthy responses.
   * null means fault forever while faultMode != none.
   */
  faultRemaining: number | null;
  /** Artificial delay in ms before responding (for timeout tests). */
  delayMs: number;
  rateLimitRetryAfterSeconds: number;
};

const DEFAULT_CONFIG: MockSourceConfig = {
  totalRecords: 25,
  defaultPageSize: 10,
  faultMode: "none",
  faultRemaining: null,
  delayMs: 0,
  rateLimitRetryAfterSeconds: 1,
};

/**
 * In-memory deterministic source used by the mock REST plugin and direct adapter.
 */
export class MockLocationStore {
  private records: RawLocation[];
  private config: MockSourceConfig;

  constructor(config: Partial<MockSourceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.records = buildMockLocations(this.config.totalRecords);
  }

  getConfig(): MockSourceConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<MockSourceConfig>): void {
    const next = { ...this.config, ...patch };
    if (patch.totalRecords != null && patch.totalRecords !== this.config.totalRecords) {
      this.records = buildMockLocations(patch.totalRecords);
    }
    this.config = next;
  }

  replaceAll(records: RawLocation[]): void {
    this.records = [...records].sort((a, b) => a.external_id.localeCompare(b.external_id));
    this.config.totalRecords = this.records.length;
  }

  upsert(record: RawLocation): void {
    const idx = this.records.findIndex((r) => r.external_id === record.external_id);
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
      this.records.sort((a, b) => a.external_id.localeCompare(b.external_id));
    }
    this.config.totalRecords = this.records.length;
  }

  /** Rebuild deterministic fixtures with the given size. */
  reset(totalRecords = this.config.totalRecords): void {
    this.records = buildMockLocations(totalRecords);
    this.config = {
      ...this.config,
      totalRecords,
      faultMode: "none",
      faultRemaining: null,
      delayMs: 0,
    };
  }

  /**
   * Consume one fault application if configured.
   * Returns the fault to apply for this request, or "none".
   */
  consumeFault(): SourceFaultMode {
    if (this.config.faultMode === "none") return "none";
    if (this.config.faultRemaining == null) return this.config.faultMode;
    if (this.config.faultRemaining <= 0) return "none";
    this.config.faultRemaining -= 1;
    const mode = this.config.faultMode;
    if (this.config.faultRemaining <= 0) {
      this.config.faultMode = "none";
    }
    return mode;
  }

  getAll(): RawLocation[] {
    return [...this.records];
  }

  listPage(cursor: string | null, limit: number): {
    records: RawLocation[];
    nextCursor: string | null;
    pageNumber: number;
  } {
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isFinite(start) || start < 0) {
      throw new Error(`Invalid cursor '${cursor}'`);
    }
    const pageSize = Math.min(Math.max(limit, 1), 100);
    const slice = this.records.slice(start, start + pageSize);
    const nextStart = start + slice.length;
    const nextCursor = nextStart < this.records.length ? String(nextStart) : null;
    const pageNumber = Math.floor(start / pageSize) + 1;
    return { records: slice, nextCursor, pageNumber };
  }
}

export const defaultMockStore = new MockLocationStore();
