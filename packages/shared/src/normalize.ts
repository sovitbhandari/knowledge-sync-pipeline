import { parsePhoneNumberFromString } from "libphonenumber-js";
import { createHash } from "node:crypto";
import {
  type CanonicalLocation,
  LocationValidationError,
  type RawLocation,
  type ValidationIssue,
  rawLocationSchema,
} from "./location.js";

const US_STATE_MAP: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const CA_PROVINCE_MAP: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  "northwest territories": "NT",
  "nova scotia": "NS",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

const COUNTRY_MAP: Record<string, string> = {
  us: "US",
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  ca: "CA",
  can: "CA",
  canada: "CA",
};

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = collapseWhitespace(value);
  return normalized.length === 0 ? null : normalized;
}

function normalizeCountry(raw: string, issues: ValidationIssue[]): string | null {
  const key = collapseWhitespace(raw).toLowerCase();
  const country = COUNTRY_MAP[key] ?? (key.length === 2 ? key.toUpperCase() : null);
  if (!country || !(country in { US: 1, CA: 1 })) {
    issues.push({
      path: "country",
      code: "unsupported_country",
      message: `Unsupported country '${raw}'. Supported: US, CA (and common aliases).`,
    });
    return null;
  }
  return country;
}

function normalizeState(
  raw: string,
  country: string | null,
  issues: ValidationIssue[],
): string | null {
  const collapsed = collapseWhitespace(raw);
  if (!country) return null;

  const upper = collapsed.toUpperCase();
  const map = country === "US" ? US_STATE_MAP : CA_PROVINCE_MAP;
  const fromName = map[collapsed.toLowerCase()];
  const code = fromName ?? (upper.length <= 3 ? upper : null);

  if (!code || !Object.values(map).includes(code)) {
    issues.push({
      path: "state",
      code: "unsupported_state",
      message: `Unsupported state/province '${raw}' for country ${country}.`,
    });
    return null;
  }
  return code;
}

function normalizeWebsite(raw: string | null | undefined, issues: ValidationIssue[]): string | null {
  const value = emptyToNull(raw);
  if (value == null) return null;

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      issues.push({
        path: "website",
        code: "invalid_website",
        message: `Website must be http(s): '${raw}'`,
      });
      return null;
    }
    url.hash = "";
    let normalized = url.toString();
    if (normalized.endsWith("/") && url.pathname === "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    issues.push({
      path: "website",
      code: "invalid_website",
      message: `Invalid website URL '${raw}'`,
    });
    return null;
  }
}

function normalizePhone(
  raw: string | null | undefined,
  country: string | null,
  issues: ValidationIssue[],
): string | null {
  const value = emptyToNull(raw);
  if (value == null) return null;
  if (!country) return null;

  const parsed = parsePhoneNumberFromString(value, country as "US" | "CA");
  if (!parsed || !parsed.isValid()) {
    issues.push({
      path: "phone",
      code: "invalid_phone",
      message: `Invalid phone number '${raw}' for country ${country}.`,
    });
    return null;
  }
  return parsed.format("E.164");
}

function parseSourceUpdatedAt(raw: string, issues: ValidationIssue[]): Date | null {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    issues.push({
      path: "source_updated_at",
      code: "invalid_timestamp",
      message: `Invalid source_updated_at '${raw}'`,
    });
    return null;
  }
  return date;
}

export function contentHashForCanonical(
  input: Omit<CanonicalLocation, "contentHash">,
): string {
  const payload = JSON.stringify({
    externalId: input.externalId,
    name: input.name,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    phoneE164: input.phoneE164,
    websiteUrl: input.websiteUrl,
    category: input.category,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Validate and normalize a raw source record into the canonical schema.
 * Does not fabricate missing address or contact fields.
 */
export function normalizeLocation(input: unknown): CanonicalLocation {
  const parsed = rawLocationSchema.safeParse(input);
  if (!parsed.success) {
    throw new LocationValidationError(
      "Raw location failed schema validation",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  const raw: RawLocation = parsed.data;
  const issues: ValidationIssue[] = [];

  const country = normalizeCountry(raw.country, issues);
  const state = normalizeState(raw.state, country, issues);
  const websiteUrl = normalizeWebsite(raw.website, issues);
  const phoneE164 = normalizePhone(raw.phone, country, issues);
  const sourceUpdatedAt = parseSourceUpdatedAt(raw.source_updated_at, issues);

  const addressLine1 = collapseWhitespace(raw.address_line1);
  const city = collapseWhitespace(raw.city);
  const postalCode = collapseWhitespace(raw.postal_code);
  const name = collapseWhitespace(raw.name);
  const category = collapseWhitespace(raw.category);
  const externalId = collapseWhitespace(raw.external_id);
  const addressLine2 = emptyToNull(raw.address_line2);

  if (!addressLine1) {
    issues.push({
      path: "address_line1",
      code: "required",
      message: "address_line1 is required and cannot be blank",
    });
  }
  if (!city) {
    issues.push({
      path: "city",
      code: "required",
      message: "city is required and cannot be blank",
    });
  }
  if (!postalCode) {
    issues.push({
      path: "postal_code",
      code: "required",
      message: "postal_code is required and cannot be blank",
    });
  }

  if (issues.length > 0 || !country || !state || !sourceUpdatedAt) {
    throw new LocationValidationError("Location normalization failed", issues);
  }

  const withoutHash = {
    externalId,
    name,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    phoneE164,
    websiteUrl,
    category,
    sourceUpdatedAt,
  };

  return {
    ...withoutHash,
    contentHash: contentHashForCanonical(withoutHash),
  };
}
