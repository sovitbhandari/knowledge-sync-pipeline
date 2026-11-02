export type SyncMode = "full" | "incremental";

export type SyncCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
};

export type SyncRunResult = SyncCounts & {
  syncRunId: string;
  sourceId: string;
  status: "completed" | "failed";
  failureReason: string | null;
  durationMs: number;
  recordsPerSecond: number | null;
};
