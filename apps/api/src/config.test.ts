import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("loads valid environment variables", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://ksp:ksp_dev_password@localhost:5432/knowledge_sync",
      API_PORT: "3001",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });

    expect(config.DATABASE_URL).toContain("knowledge_sync");
    expect(config.API_PORT).toBe(3001);
    expect(config.NODE_ENV).toBe("test");
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
