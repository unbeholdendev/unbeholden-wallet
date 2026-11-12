import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Descriptor, parseDescriptor } from "../wallet/descriptor";
import { BIP84_ZPUB } from "../wallet/vectors";
import { SignMessage, VerifyMessage } from "./Messages";

const state = vi.hoisted(() => ({
  descriptor: null as unknown as Descriptor,
  verify: vi.fn(),
  parsed: { signature: "signature" } as { signature: string; message?: string; address?: string },
  download: vi.fn(),
  request: vi.fn(),
}));
vi.mock("../app/session", () => ({
  useWallet: () => ({ descriptor: state.descriptor, network: "mainnet" }),
  useWalletSnapshot: () => ({
    addresses: {
      receive: [{ address: "own-address", path: "m/84h/0h/0h/0/0" }],
      change: [{ address: "change-address", path: "m/84h/0h/0h/1/0" }],
    },
  }),
}));
vi.mock("../wallet/message", async () => ({
  ...(await vi.importActual<typeof import("../wallet/message")>("../wallet/message")),
  signRequest: (...args: unknown[]) => {
    state.request(...args);
    return "sign request";
  },
  signFile: () => "Coldcard request",
  readSignature: () => state.parsed,
  verifyMessage: (...args: unknown[]) => state.verify(...args),
  armour: () => "armoured message",
}));
vi.mock("./Backup", () => ({ download: (...args: unknown[]) => state.download(...args) }));
vi.mock("../ui/QrScanner", () => ({
  QrScanner: ({ onResult }: { onResult: (s: string) => void }) => (
    <button type="button" onClick={() => onResult("scanned")}>
      Supply QR
    </button>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.descriptor = parseDescriptor(`wpkh([d34db33f/84h/0h/0h]${BIP84_ZPUB}/<0;1>/*)`, "mainnet");
  state.parsed = { signature: "signature" };
  state.verify.mockReturnValue({ valid: true, format: "BIP322" });
});
function exportRequest() {
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Prove ownership" } });
  fireEvent.click(screen.getByRole("button", { name: "Export signing request" }));
}
function paste() {
  fireEvent.change(screen.getByLabelText("Paste signature or armoured message"), { target: { value: "signature" } });
  fireEvent.click(screen.getByRole("button", { name: "Check signature" }));
}

describe("message signing", () => {
  it("requires 1–240 printable ASCII characters before exporting", () => {
    render(<SignMessage />);
    const button = screen.getByRole("button", { name: "Export signing request" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    for (const message of ["a\nb", "a\n", "a\r", "é", "a".repeat(241)]) {
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: message } });
      expect(button.disabled).toBe(true);
    }
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "a".repeat(240) } });
    expect(button.disabled).toBe(false);
  });
  it("exports a single QR and Coldcard file for the chosen wallet path", () => {
    render(<SignMessage />);
    fireEvent.change(screen.getByLabelText("Wallet address and derivation path"), {
      target: { value: "change-address" },
    });
    exportRequest();
    expect(screen.getByRole("img", { name: "Message signing request QR" })).toBeTruthy();
    expect(state.request).toHaveBeenCalledWith("Prove ownership", "m/84h/0h/0h/1/0");
    fireEvent.click(screen.getByRole("button", { name: "Download Coldcard text file" }));
    expect(state.download).toHaveBeenCalledWith("Coldcard request", "text/plain", "sign-message.txt");
  });
  it("checks pasted signatures before armoured export and clears success on edits", () => {
    render(<SignMessage />);
    exportRequest();
    paste();
    expect(state.verify).toHaveBeenCalledWith("own-address", "Prove ownership", "signature", "mainnet");
    fireEvent.click(screen.getByRole("button", { name: "Download armoured message" }));
    expect(state.download).toHaveBeenCalledWith("armoured message", "text/plain", "signed-message.txt");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Different" } });
    expect(screen.queryByText("Signature verified against your message and address.")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("refuses mismatched armoured content and invalid signatures", () => {
    render(<SignMessage />);
    exportRequest();
    state.parsed = { signature: "signature", message: "Different" };
    paste();
    expect(screen.getByText("The signed message differs from your message.")).toBeTruthy();
    expect(state.verify).not.toHaveBeenCalled();
    state.parsed = { signature: "signature", address: "foreign" };
    paste();
    expect(screen.getByText("The signature is for another address.")).toBeTruthy();
    state.parsed = { signature: "signature" };
    state.verify.mockReturnValue({ valid: false });
    paste();
    expect(screen.getByText("The signature does not match this message and address.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download armoured message" })).toBeNull();
  });
  it("uses the same verification boundary for camera and file imports", async () => {
    render(<SignMessage />);
    exportRequest();
    fireEvent.click(screen.getByRole("button", { name: "Scan signature QR" }));
    fireEvent.click(screen.getByRole("button", { name: "Supply QR" }));
    expect(state.verify).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Load signature file"), {
      target: { files: [{ text: async () => "file signature" }] },
    });
    await waitFor(() => expect(state.verify).toHaveBeenCalledTimes(2));
  });
  it("requires the key origin so requests carry a full signer path", () => {
    state.descriptor.keys[0]!.origin = null;
    render(<SignMessage />);
    expect(screen.getByText(/Import a descriptor with its key origin/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export signing request" })).toBeNull();
  });
  it.each([{ path: [] }, { path: [0] }, { path: [0, 1] }, { path: [0, 1, 2, 3] }])(
    "refuses incomplete or overlong origins $path",
    ({ path }) => {
      state.descriptor.keys[0]!.origin!.path = path;
      render(<SignMessage />);
      expect(screen.getByText(/Import a descriptor with its key origin/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Export signing request" })).toBeNull();
    },
  );
  it("explains unsupported Taproot and multisig signing", () => {
    state.descriptor.scriptType = "tr";
    const { unmount } = render(<SignMessage />);
    expect(screen.getByText("Taproot message signing not supported yet")).toBeTruthy();
    unmount();
    state.descriptor.multi = { threshold: 1, sorted: true };
    render(<SignMessage />);
    expect(screen.getByText("Message signing is not supported for multisig wallets.")).toBeTruthy();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });
});
describe("standalone verification", () => {
  it.each(["legacy", "BIP322"])("verifies %s with explicit network and clears results on edits", (format) => {
    state.verify.mockReturnValue({ valid: true, format });
    render(<VerifyMessage />);
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "external-address" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Any message\nwith Unicode é" } });
    paste();
    expect(state.verify).toHaveBeenCalledWith(
      "external-address",
      "Any message\nwith Unicode é",
      "signature",
      "mainnet",
    );
    expect(screen.getByText(`Valid ${format} signature for this message and address.`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Network"), { target: { value: "signet" } });
    expect(screen.queryByText(`Valid ${format} signature for this message and address.`)).toBeNull();
  });
  it("fills armoured content and reports malformed or unsupported signatures", () => {
    render(<VerifyMessage />);
    state.parsed = { signature: "signature", address: "external", message: "Armoured content" };
    state.verify.mockImplementation(() => {
      throw new Error("Unsupported signature");
    });
    paste();
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("external");
    expect(screen.getByText("Unsupported signature")).toBeTruthy();
  });
});

// https://github.com/bitcoin/bips/blob/master/bip-0322/basic-test-vectors.json
it("verifies a published BIP322 proof through the screen", async () => {
  const real = await vi.importActual<typeof import("../wallet/message")>("../wallet/message");
  state.verify.mockImplementation(real.verifyMessage);
  state.parsed = {
    address: "bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler",
    message: "No prefix fallback",
    signature: "AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R",
  };
  render(<VerifyMessage />);
  paste();
  expect(screen.getByText("Valid BIP322 signature for this message and address.")).toBeTruthy();
  state.parsed = { signature: state.parsed.signature };
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Changed message" } });
  paste();
  expect(screen.getByText("The signature does not match this message and address.")).toBeTruthy();
});
