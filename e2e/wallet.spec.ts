import { expect, test, type Page } from "@playwright/test";
import { DEMO_URL } from "../playwright.config";

async function open(page: Page) {
  // The fake chain's header time at the demo tip, 153,500, and ten minutes.
  await page.clock.setFixedTime(1_792_100_600_000);
  await page.goto(DEMO_URL);
  await page.getByLabel("Passphrase").fill("demo passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/Up to date at block 153 500/)).toBeVisible({ timeout: 15_000 });
}

const screens = [
  ["home", "#/home"],
  ["tx", "#/tx/"],
  ["receive", "#/receive"],
  ["coins", "#/coins"],
  ["coin", "#/coin/"],
  ["addresses", "#/addresses"],
  ["settings", "#/settings"],
] as const;

for (const width of [390, 1280])
  for (const scheme of ["light", "dark"] as const)
    test(`wallet views at ${width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 720 ? 844 : 800 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      for (const [name, hash] of screens) {
        if (name === "tx") await page.getByRole("link", { name: "Rent, October" }).click();
        else if (name === "coin") await page.getByRole("link", { name: /0\.01 048 560/ }).click();
        else await page.evaluate((h) => (location.hash = h), hash);
        await expect(page.locator("h1").first()).toBeAttached();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `test-results/wallet-views/${name}-${width}-${scheme}.png`, fullPage: true });
      }
    });

test("freezing a coin takes it out of the spendable balance", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (location.hash = "#/coins"));
  const spendable = page.locator("dt", { hasText: "Spendable now" }).locator("+ dd");
  const before = await spendable.textContent();
  await page.getByRole("button", { name: /^Freeze 0\.06/ }).click();
  await expect(spendable).not.toHaveText(before!);
  await expect(page.getByRole("button", { name: /^Unfreeze 0\.06/ })).toBeVisible();
});

test("custom explorer links stay idle until opened and fit phone and desktop screens", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://explorer.example/")) requests.push(request.url());
  });
  await open(page);
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.getByLabel("Explorer URL").fill("https://explorer.example/bitcoin/");
  await page.getByRole("button", { name: "Save explorer", exact: true }).click();
  await expect(page.getByText("Explorer saved", { exact: true })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["home", "receive", "addresses", "coins"]) {
      await page.evaluate((r) => (location.hash = `#/${r}`), route);
      if (route === "home") await page.getByRole("link", { name: "Rent, October", exact: true }).click();
      await expect(page.locator('a[href^="https://explorer.example/bitcoin/"]').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
  expect(requests).toEqual([]);
});
