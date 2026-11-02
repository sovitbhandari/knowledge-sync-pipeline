export {
  canonicalLocationSchema,
  LocationValidationError,
  rawLocationSchema,
  type CanonicalLocation,
  type RawLocation,
  type ValidationIssue,
} from "./location.js";

export { contentHashForCanonical, normalizeLocation } from "./normalize.js";

export const PACKAGE_NAME = "@ksp/shared" as const;
export const PROJECT_NAME = "knowledge-sync-pipeline" as const;
