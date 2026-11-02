import { describe, expect, it } from "vitest";
import { LocationValidationError, normalizeLocation } from "./index.js";

const validRaw = {
  external_id: "loc-1",
  name: "  Acme Coffee  ",
  address_line1: " 100 Main St ",
  address_line2: "",
  city: "Austin",
  state: "Texas",
  postal_code: "78701",
  country: "United States",
  phone: "(512) 555-0100",
  website: "acme.example.com/stores",
  category: "Coffee Shop",
  source_updated_at: "2024-01-15T12:00:00.000Z",
};

describe("normalizeLocation", () => {
  it("normalizes whitespace, region, phone, and website", () => {
    const canonical = normalizeLocation(validRaw);
    expect(canonical.name).toBe("Acme Coffee");
    expect(canonical.addressLine1).toBe("100 Main St");
    expect(canonical.addressLine2).toBeNull();
    expect(canonical.state).toBe("TX");
    expect(canonical.country).toBe("US");
    expect(canonical.phoneE164).toBe("+15125550100");
    expect(canonical.websiteUrl).toBe("https://acme.example.com/stores");
    expect(canonical.contentHash).toHaveLength(64);
  });

  it("rejects missing required address fields without fabricating them", () => {
    expect(() =>
      normalizeLocation({
        ...validRaw,
        address_line1: "   ",
      }),
    ).toThrow(LocationValidationError);
  });

  it("rejects unsupported countries", () => {
    try {
      normalizeLocation({ ...validRaw, country: "FR" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LocationValidationError);
      expect((error as LocationValidationError).issues.some((i) => i.path === "country")).toBe(
        true,
      );
    }
  });
});
