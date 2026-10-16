import { expect, test } from "@playwright/test";

test("keeps working offline once loaded", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+\+\w+/)).toBeVisible();
});
