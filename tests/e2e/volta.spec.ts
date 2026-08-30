import { expect, test } from "@playwright/test";

/**
 * The demo the jury is shown, executed. One delegation, the market worked
 * unattended, a commitment that refuses to complete without evidence, an
 * exception that reaches a human, and a briefing change that reopens the deal.
 */
test("operator delegates once and the agent works the market", async ({ page }) => {
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

  const briefingRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().endsWith("/api/operations/op-2041"),
  );
  await page.getByTestId("start-scan").click();
  const briefingPayload = (await briefingRequest).postDataJSON();
  expect(briefingPayload).toMatchObject({ customer: "Demo Customer", pickupLocation: "Port of Veracruz" });
  expect(briefingPayload.carriers[0]).toMatchObject({ name: "Northstar Cargo", dispatcher: "Ana Gómez" });

  // The operator pressed one button. Ranking, the booking call and the recap
  // all happen without them, so the winner is already standing.
  await expect(page.getByText("BEST ELIGIBLE", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "RutaPac booked" })).toBeVisible();
  await expect(page.getByTestId("book-winner")).toHaveCount(0);

  // The cheapest quote is on the board and did not win.
  await expect(page.getByText("BLOCKED", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("call-brief")).toContainText("Rates mentioned");
  await expect(page.getByTestId("call-brief")).toContainText("8,500");

  // No recording exists behind a simulated call, so the gate stops short of
  // committed and the ledger says why rather than claiming otherwise.
  await expect(page.locator(".outcome-pending")).toContainText("verification in progress");
  await expect(page.getByTestId("commitment-status")).toHaveText("RECAP SENT");
});

test("an exception reaches a human and a changed briefing reopens the deal", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo access code").fill("volta");
  await page.getByRole("button", { name: "Enter control room" }).click();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/operations/op-2041/reset") && response.ok()),
    page.getByRole("button", { name: "New operation" }).click(),
  ]);
  await page.getByTestId("start-scan").click();
  await expect(page.getByRole("heading", { name: "RutaPac booked" })).toBeVisible();

  await page.getByRole("button", { name: "Inbound exception" }).click();
  await expect(page.getByText("Authority boundary reached")).toBeVisible();
  await expect(page.getByText("Agent is not authorized to change the agreed terms.")).toBeVisible();

  await page.getByRole("button", { name: "TAKE OVER CALL" }).click();
  // Once a human is on the line the drawer steps off the market comparison.
  await expect(page.locator(".escalation-drawer.collapsed")).toBeVisible();
  await expect(page.locator(".escalation-drawer")).toContainText("CONNECTED");

  // The briefing changed, so the standing agreement is retired and the same
  // carrier is called back rather than the terms being edited underneath them.
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/operations/op-2041/renegotiate") && response.ok()),
    page.getByTestId("renegotiate").click(),
  ]);
  await expect(page.getByText("AT RISK", { exact: true })).toBeVisible();
  await expect(page.getByTestId("renegotiate")).toHaveCount(0);
});
