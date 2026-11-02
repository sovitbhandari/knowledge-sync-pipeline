import { parse } from "csv-parse/sync";
import { rawLocationSchema, type RawLocation } from "@ksp/shared";
import type { SourceAdapter, SourcePage } from "../types.js";

const REQUIRED_COLUMNS = [
  "external_id",
  "name",
  "address_line1",
  "city",
  "state",
  "postal_code",
  "country",
  "category",
  "source_updated_at",
] as const;

export type CsvAdapterOptions = {
  /** CSV text content */
  csvText: string;
  key?: string;
};

/**
 * CSV upload adapter. Emits the same RawLocation shape as the REST adapter
 * so both share the canonical validation pipeline.
 */
export class CsvAdapter implements SourceAdapter {
  readonly key: string;
  private readonly records: RawLocation[];
  private served = false;

  constructor(opts: CsvAdapterOptions) {
    this.key = opts.key ?? "csv-upload";
    this.records = parseCsv(opts.csvText);
  }

  async fetchPage(cursor: string | null, pageSize: number): Promise<SourcePage> {
    if (this.served && cursor == null) {
      return { records: [], nextCursor: null, pageNumber: 1 };
    }

    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isFinite(start) || start < 0) {
      throw new Error(`Invalid CSV cursor '${cursor}'`);
    }

    const slice = this.records.slice(start, start + pageSize);
    const nextStart = start + slice.length;
    const nextCursor = nextStart < this.records.length ? String(nextStart) : null;
    this.served = true;

    return {
      records: slice,
      nextCursor,
      pageNumber: Math.floor(start / Math.max(pageSize, 1)) + 1,
    };
  }
}

export function parseCsv(csvText: string): RawLocation[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0] ?? {});
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      throw new Error(`CSV missing required column '${col}'`);
    }
  }

  return rows.map((row) => {
    const candidate = {
      external_id: row.external_id ?? "",
      name: row.name ?? "",
      address_line1: row.address_line1 ?? "",
      address_line2: emptyToNull(row.address_line2),
      city: row.city ?? "",
      state: row.state ?? "",
      postal_code: row.postal_code ?? "",
      country: row.country ?? "",
      phone: emptyToNull(row.phone),
      website: emptyToNull(row.website),
      category: row.category ?? "",
      source_updated_at: row.source_updated_at ?? "",
    };
    // Preserve invalid rows for downstream rejection rather than dropping here.
    const parsed = rawLocationSchema.safeParse(candidate);
    return parsed.success ? parsed.data : (candidate as RawLocation);
  });
}

export function locationsToCsv(records: RawLocation[]): string {
  const header = [
    "external_id",
    "name",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "phone",
    "website",
    "category",
    "source_updated_at",
  ];
  const lines = [header.join(",")];
  for (const r of records) {
    lines.push(
      [
        r.external_id,
        r.name,
        r.address_line1,
        r.address_line2 ?? "",
        r.city,
        r.state,
        r.postal_code,
        r.country,
        r.phone ?? "",
        r.website ?? "",
        r.category,
        r.source_updated_at,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function emptyToNull(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
