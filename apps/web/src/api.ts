export type Source = {
  id: string;
  key: string;
  name: string;
  adapterType: string;
  isActive: boolean;
};

export type SyncRunSummary = {
  id: string;
  sourceKey: string;
  sourceName: string;
  mode: string;
  status: string;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  retryCount: number;
  durationMs: number | null;
  failureCategory: string | null;
  failureReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type RejectedRecord = {
  id: string;
  externalId: string | null;
  reason: string;
  validationErrors: unknown;
  rejectedAt: string;
};

export type SyncRunDetail = SyncRunSummary & {
  rejectedRecords: RejectedRecord[];
  events: Array<{
    id: string;
    eventType: string;
    message: string;
    createdAt: string;
  }>;
};

export type LocationRow = {
  id: string;
  sourceKey: string;
  externalId: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  category: string;
  phoneE164: string | null;
  websiteUrl: string | null;
  syncedAt: string;
};

export type Paginated<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type Overview = {
  latest: {
    id: string;
    sourceKey: string;
    sourceName: string;
    status: string;
    insertedCount: number;
    updatedCount: number;
    unchangedCount: number;
    rejectedCount: number;
    finishedAt: string | null;
    failureReason: string | null;
  } | null;
  totals: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new Error(
      "Cannot reach the API. Start it with `npm run dev:api` (Postgres must be up on DATABASE_URL).",
    );
  }

  const raw = await response.text();
  let body: unknown = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { message: raw.slice(0, 200) };
    }
  }

  if (!response.ok) {
    const proxyDown =
      response.status >= 500 &&
      (raw.includes("ECONNREFUSED") ||
        raw.includes("http proxy error") ||
        raw.trim().length === 0);
    if (proxyDown) {
      throw new Error(
        "API is not running on :3001. In another terminal run `npm run db:up`, then `npm run dev:api`.",
      );
    }
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: string }).message)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

export const api = {
  getSources: () => request<{ data: Source[] }>("/api/sources"),
  getOverview: () => request<{ data: Overview }>("/api/syncs/overview/latest"),
  getSyncs: (page = 1) =>
    request<Paginated<SyncRunSummary>>(`/api/syncs?page=${page}&pageSize=10`),
  getSync: (id: string) => request<{ data: SyncRunDetail }>(`/api/syncs/${id}`),
  createSync: (payload: { sourceKey: string; pageSize?: number; csvText?: string }) =>
    request<{ data: { id: string; status: string; insertedCount: number } }>("/api/syncs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getLocations: (params: { page?: number; q?: string; state?: string }) => {
    const search = new URLSearchParams();
    search.set("page", String(params.page ?? 1));
    search.set("pageSize", "20");
    if (params.q) search.set("q", params.q);
    if (params.state) search.set("state", params.state);
    return request<Paginated<LocationRow>>(`/api/locations?${search.toString()}`);
  },
};
