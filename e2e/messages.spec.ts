import { expect, test } from "@playwright/test";
import { DEMO_URL } from "../playwright.config";

for (const width of [390, 1280]) {
  test(`message verification and signing request at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/verify-message");
    await page.getByLabel("Address", { exact: true }).fill("bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("No prefix fallback");
    // https://github.com/bitcoin/bips/blob/master/bip-0322/basic-test-vectors.json
    await page.getByLabel("Paste signature or armoured message").fill("AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R");
    await page.getByRole("button", { name: "Check signature" }).click();
    await expect(page.getByText("Valid BIP322 signature for this message and address.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Different");
    await page.getByRole("button", { name: "Check signature" }).click();
    await expect(page.getByText("The signature does not match this message and address.")).toBeVisible();

    await page.goto(DEMO_URL);
    await page.getByLabel("Passphrase").fill("demo passphrase");
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.evaluate(() => { location.hash = "#/sign-message"; });
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("x".repeat(240));
    await page.getByRole("button", { name: "Export signing request" }).click();
    await expect(page.getByRole("img", { name: "Message signing request QR" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Coldcard text file" }).click();
    expect((await downloading).suggestedFilename()).toBe("sign-message.txt");
  });
}
