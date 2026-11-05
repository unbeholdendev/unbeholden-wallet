import { expect, test } from "@playwright/test";
import { DEMO_URL } from "../playwright.config";
import { BIP86_XPUB } from "../src/wallet/vectors";

test("named accounts keep receive addresses and coins separate on phone and desktop", async ({ page }) => {
  // The fake chain's header time at the demo tip, 153,500, and ten minutes.
  await page.clock.setFixedTime(1_792_100_600_000);
  await page.goto(DEMO_URL);
  await page.getByLabel("Passphrase").fill("demo passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/Up to date at block/)).toBeVisible();
  await page.evaluate(() => (location.hash = "#/import"));
  await page.getByLabel("Descriptor or extended public key").fill(`tr(${BIP86_XPUB}/<0;1>/*)`);
  await page.getByLabel("Wallet", { exact: true }).selectOption({ label: "Spending" });
  await page.getByLabel("Account name").fill("Daily");
  await page.getByRole("button", { name: /Continue to backup/ }).click();
  await page.getByRole("button", { name: "Finish without a backup" }).click();
  await expect(page.locator("header summary")).toHaveText(/SpendingDaily/);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => (location.hash = "#/settings"));
    await expect(page.getByText("Each account has its own descriptor", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/accounts-${width}.png`, fullPage: true });
  }
  await page.evaluate(() => (location.hash = "#/receive"));
  await expect(page.getByTestId("receive-address")).toBeVisible();
  const dailyAddress = await page.getByTestId("receive-address").textContent();
  await page.locator("header summary").click();
  await page.getByRole("button", { name: /Spending \/ Spending/ }).click();
  await expect(page.getByTestId("receive-address")).not.toHaveText(dailyAddress!);
  await page.locator("header summary").click();
  await page.getByRole("button", { name: /Spending \/ Daily/ }).click();
  await expect(page.getByTestId("receive-address")).toHaveText(dailyAddress!);
  await page.evaluate(() => (location.hash = "#/coins"));
  await expect(page.getByText("Kraken withdrawals", { exact: true })).toHaveCount(0);
  await page.locator("header summary").click();
  await page.getByRole("button", { name: /Spending \/ Spending/ }).click();
  await expect(page.getByText("Kraken withdrawals", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => (location.hash = "#/send"));
  await page.getByLabel("Address", { exact: true }).fill(dailyAddress!.replace(/\s/g, ""));
  await page.locator("header summary").click();
  await page.getByRole("button", { name: /Spending \/ Daily/ }).click();
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue("");
  await page.locator("header summary").click();
  await page.getByRole("button", { name: /Spending \/ Spending/ }).click();
  await page.reload();
  await page.getByLabel("Passphrase").fill("demo passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("header summary")).toHaveText(/SpendingSpending/);
});
