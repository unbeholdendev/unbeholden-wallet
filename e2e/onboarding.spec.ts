import { expect, test } from "@playwright/test";

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`onboarding starts at the server and reaches the connection guidance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");

    const server = page.getByLabel("Server address");
    await server.fill("ws://127.0.0.1:1");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByRole("heading", { name: "Nothing at 127.0.0.1:1 accepted the connection" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();

    await page.reload();
    await expect(server).toHaveValue("");
  });
}
