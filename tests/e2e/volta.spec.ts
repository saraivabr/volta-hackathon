import { expect, test } from "@playwright/test";

test("operator completes the verified demo cycle", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo access code").fill("volta");
  await page.getByRole("button", { name: "Enter control room" }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("heading", { name: "Ready to delegate" })).toBeVisible();

  await page.getByTestId("start-scan").click();
  await expect(page.getByText("BEST ELIGIBLE")).toBeVisible();
  await expect(page.getByText("RutaPac", { exact: true }).first()).toBeVisible();

  await page.getByTestId("book-winner").click();
  await expect(page.getByRole("heading", { name: "RutaPac booked" })).toBeVisible();
  await expect(page.getByText("COMMITTED", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Inbound exception" }).click();
  await expect(page.getByText("Authority boundary reached")).toBeVisible();
  await page.getByRole("button", { name: "TAKE OVER CALL" }).click();
  await expect(page.getByRole("button", { name: "HUMAN CONNECTED" })).toBeVisible();
});
