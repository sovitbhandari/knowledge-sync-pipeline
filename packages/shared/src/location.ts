import { z } from "zod";

/** Raw inbound shape before normalization (REST JSON or CSV row). */
export const rawLocationSchema = z.object({
  external_id: z.string().min(1),
  name: z.string().min(1),
  address_line1: z.string().min(1),
  address_line2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  category: z.string().min(1),
  source_updated_at: z.string().min(1),
});

export type RawLocation = z.infer<typeof rawLocationSchema>;

/** Canonical normalized location used for persistence. */
export const canonicalLocationSchema = z.object({
  externalId: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  addressLine1: z.string().min(1).max(512),
  addressLine2: z.string().max(512).nullable(),
  city: z.string().min(1).max(255),
  state: z.string().min(1).max(64),
  postalCode: z.string().min(1).max(32),
  country: z.string().length(2),
  phoneE164: z.string().max(32).nullable(),
  websiteUrl: z.string().url().max(2048).nullable(),
  category: z.string().min(1).max(128),
  sourceUpdatedAt: z.date(),
  contentHash: z.string().length(64),
});

export type CanonicalLocation = z.infer<typeof canonicalLocationSchema>;

export type ValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export class LocationValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = "LocationValidationError";
    this.issues = issues;
  }
}
