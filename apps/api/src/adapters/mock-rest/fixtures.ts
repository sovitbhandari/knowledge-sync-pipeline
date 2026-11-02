import type { RawLocation } from "@ksp/shared";

const CITIES: Array<{ city: string; state: string; postal: string }> = [
  { city: "Austin", state: "TX", postal: "78701" },
  { city: "Denver", state: "CO", postal: "80202" },
  { city: "Seattle", state: "WA", postal: "98101" },
  { city: "Boston", state: "MA", postal: "02108" },
  { city: "Chicago", state: "IL", postal: "60601" },
  { city: "Toronto", state: "ON", postal: "M5H 2N2" },
  { city: "Vancouver", state: "BC", postal: "V6B 1A1" },
  { city: "Miami", state: "FL", postal: "33131" },
];

const CATEGORIES = ["Coffee Shop", "Bookstore", "Pharmacy", "Hardware", "Bakery"] as const;

const BASE_EPOCH_MS = Date.UTC(2024, 0, 1, 12, 0, 0);

/**
 * Deterministic synthetic business-location fixtures.
 * Ordering is by external_id ascending for stable pagination.
 */
export function buildMockLocations(count: number): RawLocation[] {
  const records: RawLocation[] = [];
  for (let i = 1; i <= count; i += 1) {
    const place = CITIES[(i - 1) % CITIES.length]!;
    const country = place.state === "ON" || place.state === "BC" ? "CA" : "US";
    // Use valid NANP-style numbers (avoid 555 fiction block which fails libphonenumber isValid).
    const area = country === "US" ? "512" : "416";
    const subscriber = String(2000000 + i).slice(-7);
    records.push({
      external_id: `loc-${String(i).padStart(6, "0")}`,
      name: `Demo Business ${i}`,
      address_line1: `${100 + (i % 900)} Market Street`,
      address_line2: i % 7 === 0 ? `Suite ${i % 50}` : null,
      city: place.city,
      state: place.state,
      postal_code: place.postal,
      country,
      phone: `+1${area}${subscriber}`,
      website: `https://demo-business-${i}.example.com`,
      category: CATEGORIES[(i - 1) % CATEGORIES.length]!,
      source_updated_at: new Date(BASE_EPOCH_MS + i * 60_000).toISOString(),
    });
  }
  return records;
}

export function mutateLocationName(record: RawLocation, name: string): RawLocation {
  return {
    ...record,
    name,
    source_updated_at: new Date(Date.parse(record.source_updated_at) + 60_000).toISOString(),
  };
}
