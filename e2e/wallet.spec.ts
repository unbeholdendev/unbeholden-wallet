import { expect, test, type Page } from "@playwright/test";
import { DEMO_URL } from "../playwright.config";

async function open(page: Page) {
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
