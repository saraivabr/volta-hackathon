import { expect, test } from "@playwright/test";

test("operator completes the verified demo cycle", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo access code").fill("volta");
  await page.getByRole("button", { name: "Enter control room" }).click();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/operations/op-2041/reset") && response.ok()),
    page.getByRole("button", { name: "New operation" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Ready to delegate" })).toBeVisible();

  await page.getByRole("button", { name: "Edit briefing" }).click();
  await page.getByLabel("Customer").fill("Demo Customer");
  await page.getByLabel("Pickup location").fill("Port of Veracruz");
  await page.getByLabel("Delivery location").fill("Mexico City");
  await page.getByLabel("Carrier").first().fill("Northstar Cargo");
  await page.getByLabel("Dispatcher").first().fill("Ana Gómez");

  await expect(page.getByLabel("Customer")).toHaveValue("Demo Customer");
  await expect(page.getByLabel("Carrier").first()).toHaveValue("Northstar Cargo");
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url().endsWith("/api/operations/op-2041") && response.ok(),
    ),
    page.getByRole("button", { name: "Save briefing" }).click(),
  ]);
  await expect(page.getByLabel("Customer")).toBeDisabled();
  await expect(page.getByLabel("Customer")).toHaveValue("Demo Customer");
  const briefingRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().endsWith("/api/operations/op-2041"),
  );
  await page.getByTestId("start-scan").click();
  const briefingPayload = (await briefingRequest).postDataJSON();
  expect(briefingPayload).toMatchObject({
    customer: "Demo Customer",
    pickupLocation: "Port of Veracruz",
  });
  expect(briefingPayload.carriers[0]).toMatchObject({ name: "Northstar Cargo", dispatcher: "Ana Gómez" });
  await expect(page.getByText("BEST ELIGIBLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Northstar Cargo", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Port of Veracruz", { exact: true })).toBeVisible();

  await page.getByTestId("book-winner").click();
  await expect(page.getByRole("heading", { name: "RutaPac booked" })).toBeVisible();
  await expect(page.getByText("COMMITTED", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("call-brief")).toContainText("Rates mentioned");
  await expect(page.getByTestId("call-brief")).toContainText("8,500");

  await page.getByRole("button", { name: "Inbound exception" }).click();
  await expect(page.getByText("Authority boundary reached")).toBeVisible();
  await page.getByRole("button", { name: "TAKE OVER CALL" }).click();
  await expect(page.getByRole("button", { name: "HUMAN CONNECTED" })).toBeVisible();
});
