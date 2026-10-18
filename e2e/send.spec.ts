import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Transaction } from "@scure/btc-signer";
import { BIP84, buildFixture, ELECTRUM_WS, mine, rpc, signPsbt } from "../scripts/regtest/fixture";
import { qrMatrix } from "../src/transport/qr";
import { psbtUrEncoder } from "../src/transport/ur";

const PASSPHRASE = "correct horse battery staple";
const SHOTS = resolve("test-results/screens");
const VIDEO = join(tmpdir(), "btc-wallet-e2e", "signer.y4m");
const W = 640;
const H = 480;

/** Raw 4:2:0 video, one QR code per frame on white, for Chromium's fake camera. */
// https://wiki.multimedia.cx/index.php/YUV4MPEG2
function y4m(frames: (boolean[][] | null)[]): Buffer {
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const out = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
  for (const matrix of frames) {
    const luma = Buffer.alloc(W * H, 235);
    if (matrix) {
      const scale = Math.floor((H - 40) / matrix.length);
      const x0 = Math.floor((W - matrix.length * scale) / 2);
      const y0 = Math.floor((H - matrix.length * scale) / 2);
      matrix.forEach((row, y) =>
        row.forEach((dark, x) => {
          if (!dark) return;
          for (let dy = 0; dy < scale; dy++) luma.fill(16, (y0 + y * scale + dy) * W + x0 + x * scale, (y0 + y * scale + dy) * W + x0 + (x + 1) * scale);
        }),
      );
    }
    out.push(Buffer.from("FRAME\n"), luma, chroma);
  }
  return Buffer.concat(out);
}

mkdirSync(join(tmpdir(), "btc-wallet-e2e"), { recursive: true });
writeFileSync(VIDEO, y4m([null]));

test.use({
  permissions: ["camera", "clipboard-read", "clipboard-write"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${VIDEO}`],
  },
});

test.beforeAll(async () => {
  try {
    await rpc("getblockcount");
  } catch {
    test.skip(true, "Needs the regtest stack: bun run regtest:up");
  }
  await mine();
  await buildFixture();
});

async function shoot(page: Page, name: string) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width > 720 ? 800 : 844 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.screenshot({ path: `${SHOTS}/${name}-${width}-${colorScheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
}

async function savePsbt(page: Page): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save PSBT file" }).click()]);
  return new Uint8Array(readFileSync(await download.path()));
}

const go = (page: Page, hash: string) => page.evaluate((h) => (location.hash = h), hash);

test("send, sign from a file, broadcast, then bump and sign the replacement through the camera", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await page.getByLabel("Type it again").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Create vault" }).click();
  await page.getByLabel("Electrum server address").fill(ELECTRUM_WS);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByLabel("Descriptor or extended public key").fill(BIP84.text);
  await page.getByRole("button", { name: "Regtest" }).click();
  await page.getByLabel("Name").fill("Regtest bench");
  await page.getByRole("button", { name: /Continue to backup/ }).click();
  await page.getByRole("button", { name: "Copy" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(/#\/home$/);

  await go(page, "#/send");
  await expect(page.getByRole("checkbox", { name: /Unconfirmed, from someone else/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("checkbox", { name: /Waits on an unconfirmed parent/ }).first()).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("textbox", { name: "Address" }).fill(await rpc("getnewaddress"));
  await page.getByLabel("Amount, BTC").fill("0.6");
  await page.getByRole("button", { name: "Pick for me" }).click();
  await expect(page.getByRole("region", { name: "Summary" }).getByRole("button", { name: "Review and sign" })).toBeEnabled();
  await expect(page.getByText("Regtest bench added")).toBeHidden({ timeout: 6_000 });
  await shoot(page, "send");

  await page.getByRole("region", { name: "Summary" }).getByRole("button", { name: "Review and sign" }).click();
  await expect(page.getByRole("heading", { name: "Check before you sign" })).toBeVisible();
  await shoot(page, "sign-show");
  const signed = signPsbt(await savePsbt(page), BIP84);
  await page.getByRole("button", { name: "Signed it, scan it back" }).click();
  await page.getByText("No camera? Load the signed file or paste it").click();
  await page.getByLabel("Load signed file").setInputFiles({ name: "signed.psbt", mimeType: "application/octet-stream", buffer: Buffer.from(signed) });
  await expect(page.getByRole("heading", { name: "Signed and checked" })).toBeVisible();
  await shoot(page, "sign-verified");

  const txid = Transaction.fromPSBT(signed).id;
  await page.getByRole("button", { name: "Broadcast through your server" }).click();
  await expect(page).toHaveURL(new RegExp(`#/tx/${txid}$`), { timeout: 1_000 });
  await go(page, "#/send");
  await expect(page.getByRole("checkbox", { name: /Your change, unconfirmed/ }).first()).toBeVisible({ timeout: 1_000 });
  expect(await rpc("getmempoolentry", txid)).toBeTruthy();

  await go(page, `#/bump/${txid}`);
  await expect(page.getByRole("heading", { name: "Speed up this transaction" })).toBeVisible();
  await page.getByLabel("Custom rate").fill("12");
  await shoot(page, "bump");
  await page.getByRole("button", { name: "Build the replacement" }).click();
  const replacement = signPsbt(await savePsbt(page), BIP84);

  const encoder = psbtUrEncoder(replacement, 40);
  const parts = Array.from({ length: encoder.seqLen }, () => encoder.nextPart().toUpperCase());
  expect(parts.length).toBeGreaterThan(4);
  // Backwards, with repeats, so the scanner sees parts out of order and twice.
  const order = [...parts.keys()].reverse().flatMap((i) => (i % 3 ? [i] : [i, parts.length - 1 - i]));
  writeFileSync(VIDEO, y4m(order.flatMap((i) => Array(3).fill(qrMatrix(parts[i]!)))));

  await page.getByRole("button", { name: "Signed it, scan it back" }).click();
  await expect(page.getByText(new RegExp(`of ${parts.length} parts captured`))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Signed and checked" })).toBeVisible({ timeout: 30_000 });

  const replacementId = Transaction.fromPSBT(replacement).id;
  await page.getByRole("button", { name: "Broadcast through your server" }).click();
  await expect(page).toHaveURL(new RegExp(`#/tx/${replacementId}$`), { timeout: 5_000 });
  expect(await rpc("getmempoolentry", replacementId)).toBeTruthy();
  await expect(rpc("getmempoolentry", txid)).rejects.toThrow();
});
