import { expect, test } from "@playwright/test";

const PASSPHRASE = "correct horse battery staple";

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`onboarding reaches the connection guidance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");

    await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
    await page.getByLabel("Type it again").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Create vault" }).click();

    const server = page.getByLabel("Electrum server address");
    await server.fill("ws://127.0.0.1:1");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByRole("heading", { name: "Nothing at 127.0.0.1:1 accepted the connection" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();

    await page.reload();
    await page.getByLabel("Passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(server).toHaveValue("ws://127.0.0.1:1");
  });
}
