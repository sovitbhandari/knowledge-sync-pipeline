import { expect, test } from "@playwright/test";

test("dashboard displays persisted sync results after Run Sync", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Knowledge Sync Pipeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sync overview" })).toBeVisible();

  await page.getByLabel("Source").selectOption("mock-rest");
  await page.getByRole("button", { name: "Run Sync" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Sync finished" })).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByRole("heading", { name: "Sync history" })).toBeVisible();
  await expect(page.locator("table").filter({ hasText: "mock-rest" }).first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Demo Business/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Total matching:/)).toBeVisible();
  await expect(page.getByText(/Total matching: [1-9]/)).toBeVisible();
});
