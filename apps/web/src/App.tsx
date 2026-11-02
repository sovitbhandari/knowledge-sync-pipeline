import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  api,
  type LocationRow,
  type SyncRunDetail,
  type SyncRunSummary,
} from "./api";

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

function QueryState(props: {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (props.isLoading) {
    return <p className="muted" role="status">Loading…</p>;
  }
  if (props.isError) {
    return (
      <div className="error-box" role="alert">
        <p>{props.error?.message ?? "Something went wrong."}</p>
        <button type="button" className="btn btn-secondary" onClick={props.onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (props.empty) {
    return <div className="empty-box muted">{props.emptyMessage ?? "No data yet."}</div>;
  }
  return <>{props.children}</>;
}

export function App() {
  const queryClient = useQueryClient();
  const [sourceKey, setSourceKey] = useState("mock-rest");
  const [csvText, setCsvText] = useState("");
  const [selectedSyncId, setSelectedSyncId] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationState, setLocationState] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ q: "", state: "" });

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.getSources,
  });
  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: api.getOverview,
  });
  const syncsQuery = useQuery({
    queryKey: ["syncs"],
    queryFn: () => api.getSyncs(1),
  });
  const syncDetailQuery = useQuery({
    queryKey: ["sync", selectedSyncId],
    queryFn: () => api.getSync(selectedSyncId!),
    enabled: Boolean(selectedSyncId),
  });
  const locationsQuery = useQuery({
    queryKey: ["locations", appliedFilters],
    queryFn: () => api.getLocations(appliedFilters),
  });

  const runSyncMutation = useMutation({
    mutationFn: async () => {
      if (sourceKey === "csv-upload" && !csvText.trim()) {
        throw new Error("Paste CSV content before running a CSV sync.");
      }
      return api.createSync({
        sourceKey,
        pageSize: 25,
        csvText: sourceKey === "csv-upload" ? csvText : undefined,
      });
    },
    onSuccess: async (result) => {
      setSelectedSyncId(result.data.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["syncs"] }),
        queryClient.invalidateQueries({ queryKey: ["locations"] }),
        queryClient.invalidateQueries({ queryKey: ["sync", result.data.id] }),
      ]);
    },
  });

  const latest = overviewQuery.data?.data.latest;
  const syncRows: SyncRunSummary[] = syncsQuery.data?.data ?? [];
  const locations: LocationRow[] = locationsQuery.data?.data ?? [];
  const detail: SyncRunDetail | undefined = syncDetailQuery.data?.data;

  const sourceOptions = useMemo(
    () => sourcesQuery.data?.data ?? [],
    [sourcesQuery.data],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Knowledge Sync Pipeline</h1>
          <p>
            Administration console for business-location ingestion. Sync results are read from the
            live PostgreSQL-backed API.
          </p>
        </div>
      </header>

      <section className="panel" aria-labelledby="overview-heading">
        <h2 id="overview-heading">Sync overview</h2>
        <QueryState
          isLoading={overviewQuery.isLoading}
          isError={overviewQuery.isError}
          error={overviewQuery.error}
          onRetry={() => void overviewQuery.refetch()}
        >
          <div className="stats">
            <div className="stat">
              <span>Total runs</span>
              <strong>{overviewQuery.data?.data.totals.totalRuns ?? 0}</strong>
            </div>
            <div className="stat">
              <span>Completed</span>
              <strong>{overviewQuery.data?.data.totals.completedRuns ?? 0}</strong>
            </div>
            <div className="stat">
              <span>Failed</span>
              <strong>{overviewQuery.data?.data.totals.failedRuns ?? 0}</strong>
            </div>
            <div className="stat">
              <span>Last status</span>
              <strong>{latest ? <StatusBadge status={latest.status} /> : "—"}</strong>
            </div>
          </div>
          {latest ? (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Last run <code>{latest.id.slice(0, 8)}</code> on {latest.sourceName}: inserted{" "}
              {latest.insertedCount}, updated {latest.updatedCount}, unchanged {latest.unchangedCount},
              rejected {latest.rejectedCount}.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              No sync runs yet. Choose a source and run a sync.
            </p>
          )}
        </QueryState>
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="run-heading">
          <h2 id="run-heading">Run sync</h2>
          <div className="toolbar">
            <div className="field">
              <label htmlFor="source">Source</label>
              <select
                id="source"
                value={sourceKey}
                onChange={(event) => setSourceKey(event.target.value)}
              >
                {sourceOptions.length === 0 ? (
                  <>
                    <option value="mock-rest">Mock REST Source</option>
                    <option value="csv-upload">CSV Upload</option>
                  </>
                ) : (
                  sourceOptions.map((source) => (
                    <option key={source.id} value={source.key}>
                      {source.name}
                    </option>
                  ))
                )}
              </select>
            </div>
            <button
              type="button"
              className="btn"
              disabled={runSyncMutation.isPending}
              onClick={() => runSyncMutation.mutate()}
            >
              {runSyncMutation.isPending ? "Running…" : "Run Sync"}
            </button>
          </div>

          {sourceKey === "csv-upload" ? (
            <div className="field">
              <label htmlFor="csv">CSV content</label>
              <textarea
                id="csv"
                rows={6}
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                placeholder="external_id,name,address_line1,..."
              />
            </div>
          ) : null}

          {runSyncMutation.isError ? (
            <div className="error-box" role="alert">
              {runSyncMutation.error.message}
            </div>
          ) : null}
          {runSyncMutation.isSuccess ? (
            <p className="muted" role="status">
              Sync finished with status <strong>{runSyncMutation.data.data.status}</strong> (
              inserted {runSyncMutation.data.data.insertedCount}).
            </p>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="history-heading">
          <h2 id="history-heading">Sync history</h2>
          <QueryState
            isLoading={syncsQuery.isLoading}
            isError={syncsQuery.isError}
            error={syncsQuery.error}
            onRetry={() => void syncsQuery.refetch()}
            empty={syncRows.length === 0}
            emptyMessage="No sync history yet."
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Source</th>
                    <th scope="col">Status</th>
                    <th scope="col">Counts</th>
                  </tr>
                </thead>
                <tbody>
                  {syncRows.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setSelectedSyncId(run.id)}
                        >
                          {formatTime(run.finishedAt ?? run.createdAt)}
                        </button>
                      </td>
                      <td>{run.sourceKey}</td>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td>
                        +{run.insertedCount} / ~{run.updatedCount} / ={run.unchangedCount} / !
                        {run.rejectedCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </section>
      </div>

      <section className="panel" aria-labelledby="detail-heading">
        <h2 id="detail-heading">Failed-record details</h2>
        {!selectedSyncId ? (
          <p className="muted">Select a sync run to inspect rejected records and failure reasons.</p>
        ) : (
          <QueryState
            isLoading={syncDetailQuery.isLoading}
            isError={syncDetailQuery.isError}
            error={syncDetailQuery.error}
            onRetry={() => void syncDetailQuery.refetch()}
          >
            {detail ? (
              <div className="stack">
                <p>
                  <StatusBadge status={detail.status} /> {detail.sourceName} · retries{" "}
                  {detail.retryCount}
                </p>
                {detail.failureReason ? (
                  <div className="error-box" role="alert">
                    {detail.failureCategory}: {detail.failureReason}
                  </div>
                ) : null}
                {detail.rejectedRecords.length === 0 ? (
                  <p className="muted">No rejected records for this run.</p>
                ) : (
                  detail.rejectedRecords.map((item) => (
                    <div key={item.id} className="rejected">
                      <strong>{item.externalId ?? "(missing external id)"}</strong>
                      <div>{item.reason}</div>
                      <div className="muted">{formatTime(item.rejectedAt)}</div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </QueryState>
        )}
      </section>

      <section className="panel" aria-labelledby="locations-heading">
        <h2 id="locations-heading">Locations</h2>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedFilters({ q: locationQuery.trim(), state: locationState.trim() });
          }}
        >
          <div className="field">
            <label htmlFor="q">Search</label>
            <input
              id="q"
              value={locationQuery}
              onChange={(event) => setLocationQuery(event.target.value)}
              placeholder="Name, city, external id"
            />
          </div>
          <div className="field">
            <label htmlFor="state">State</label>
            <input
              id="state"
              value={locationState}
              onChange={(event) => setLocationState(event.target.value)}
              placeholder="TX"
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Apply filters
          </button>
        </form>

        <QueryState
          isLoading={locationsQuery.isLoading}
          isError={locationsQuery.isError}
          error={locationsQuery.error}
          onRetry={() => void locationsQuery.refetch()}
          empty={locations.length === 0}
          emptyMessage="No locations match the current filters."
        >
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Synchronized business locations</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">External ID</th>
                  <th scope="col">City</th>
                  <th scope="col">State</th>
                  <th scope="col">Category</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>
                      <code>{row.externalId}</code>
                    </td>
                    <td>{row.city}</td>
                    <td>{row.state}</td>
                    <td>{row.category}</td>
                    <td>{row.sourceKey}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Total matching: {locationsQuery.data?.total ?? 0}</p>
        </QueryState>
      </section>
    </div>
  );
}
