import { useState, type FormEvent } from "react";
import { Heading, isIos } from "../app/layout";
import { navigate } from "../app/route";
import { useConnection } from "../app/connection";
import { useVault } from "../app/vault";
import { Icon } from "../ui/icons";
import { Button, Field, inputClass, Notice, Segmented } from "../ui/kit";
import { QrScanner } from "../ui/QrScanner";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import { walletDescriptor, type WalletRecord } from "../core/wallets";
import { formatDescriptor, type ScriptType } from "../wallet/descriptor";
import { normaliseExtendedKey } from "../wallet/extended-key";
import type { Network } from "../wallet/network";

type Reading = { descriptor?: string; fingerprint?: string; needsType?: boolean; error?: string };

const canonical = (wallet: Pick<WalletRecord, "descriptor" | "network" | "scriptType">) =>
  formatDescriptor(walletDescriptor(wallet));

// xpub, ypub, zpub, Ypub and Zpub are the mainnet prefixes in SLIP-132. Keys for
// every test network look alike, so the server's chain picks between them.
const keyNetwork = (text: string, server: Network | null): Network =>
  /(^|[(\]])[xyzYZ]pub/.test(text.trim()) ? "mainnet" : server && server !== "mainnet" ? server : "signet";

function interpret(text: string, network: Network, scriptType: ScriptType | null): Reading {
  const input = text.trim();
  if (!input) return {};
  try {
    const needsType = !input.includes("(") && normaliseExtendedKey(input, network).scriptType === null;
    if (needsType && !scriptType) return { needsType };
    const descriptor = walletDescriptor({ descriptor: input, network, scriptType });
    return { needsType, descriptor: formatDescriptor(descriptor), fingerprint: descriptor.origin?.fingerprint };
  } catch (error) {
    return { error: `${(error as Error).message}.` };
  }
}

function DescriptorText({ children }: { children: string }) {
  return (
    <p className="m-0 rounded-control border border-rule bg-sunk px-3 py-2.5 font-mono text-[0.86em] leading-relaxed break-all text-ink select-all">
      {children}
    </p>
  );
}

export function ImportWallet() {
  const { wallets, addWallet } = useVault();
  const { connection } = useConnection();
  const toast = useToast();
  const [text, setText] = useState("");
  const [scriptType, setScriptType] = useState<ScriptType | null>(null);
  const [typedName, setTypedName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState<"key" | "backup">("key");
  const [saved, setSaved] = useState(false);

  const server = connection.phase === "connected" || connection.phase === "retrying" ? connection.network : null;
  const network = keyNetwork(text, server ?? wallets.find((w) => w.network !== "mainnet")?.network ?? null);
  const reading = interpret(text, network, scriptType);
  const duplicate = wallets.find((w) => canonical(w) === reading.descriptor);
  const fallbackName = reading.fingerprint ?? `Wallet ${wallets.length + 1}`;
  const name = typedName.trim() || fallbackName;

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (reading.descriptor && !duplicate) setStep("backup");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(reading.descriptor!);
    setSaved(true);
    toast("Descriptor copied");
  };

  const download = () => {
    const body = `${name}\n${network}\n\n${reading.descriptor}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    link.download = `${name.replace(/[^\w-]+/g, "-")}-descriptor.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    setSaved(true);
  };

  const finish = async () => {
    await addWallet({ name, descriptor: text.trim(), network, scriptType: reading.needsType ? scriptType! : undefined });
    toast(`${name} added`);
    navigate("/home");
  };

  if (step === "backup")
    return (
      <div className="grid max-w-[720px] gap-6">
        <Heading title="Back up the descriptor">
          This line is the only thing whose loss matters. Balances, history and labels can all be rebuilt from it; without
          it, this browser is the only place that knows which addresses are yours.
        </Heading>
        <DescriptorText>{reading.descriptor!}</DescriptorText>
        <div className="flex flex-wrap gap-2">
          <Button icon="copy" onClick={copy}>
            Copy
          </Button>
          <Button icon="file" onClick={download}>
            Download as a text file
          </Button>
        </div>
        <div className="grid gap-2 text-ink-2 [&_p]:m-0 [&_p]:max-w-[62ch]">
          <p>
            Keep it with your signer's backup, or anywhere you keep things for years. It holds no keys: someone who finds
            it can see your balance and history, and cannot spend.
          </p>
          <p>
            Browsers delete site data when you clear history, reset the device or run low on space. When that happens,
            you import this line again and the wallet comes back.
          </p>
        </div>
        {isIos() && (
          <Notice tone="warn">
            On an iPhone or iPad, Safari deletes this site's data after seven days without a visit unless the app is on
            your Home Screen. Treat this browser as temporary storage and the saved descriptor as the real copy.
          </Notice>
        )}
        {!saved && (
          <Notice tone="warn">
            You have not copied or downloaded it yet. If this browser's data is cleared, the wallet goes with it.
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant={saved ? "primary" : "default"} onClick={finish}>
            {saved ? "Finish" : "Finish without a backup"}
          </Button>
          <Button onClick={() => setStep("key")}>Back</Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={next} className="grid gap-x-12 gap-y-8 @min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" noValidate>
      <div className="@min-[900px]:col-span-2">
        <Heading title={wallets.length ? "Add a wallet" : "Import your wallet"}>
          Paste an output descriptor or an extended public key from your signer or another wallet. No private keys: this
          app only watches.
        </Heading>
      </div>
      <div className="grid content-start gap-4">
        <Field
          label="Descriptor or extended public key"
          hint="For example wpkh([fingerprint/84h/0h/0h]xpub…/<0;1>/*), or a zpub, vpub, xpub or tpub."
          error={reading.error ?? (duplicate ? `This wallet is already here, as ${duplicate.name}.` : undefined)}
        >
          {(props) => (
            <textarea
              {...props}
              rows={4}
              className={`${inputClass} resize-y font-mono text-[0.86em] break-all`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
            />
          )}
        </Field>
        <Button icon="camera" className="justify-self-start" onClick={() => setScanning(true)}>
          Scan a QR code
        </Button>
        {reading.descriptor && server && server !== network && (
          <Notice tone="warn">
            This is a {network === "mainnet" ? "mainnet" : "test network"} key, but your server is on {server}. The wallet
            will look empty until you connect to a {network === "mainnet" ? "mainnet" : "test network"} server.
          </Notice>
        )}
        {reading.needsType && (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Script type</span>
            <Segmented
              label="Script type"
              options={[
                { value: "wpkh", label: "Native SegWit, wpkh" },
                { value: "tr", label: "Taproot, tr" },
              ]}
              value={scriptType}
              onChange={setScriptType}
            />
            <p className="m-0 text-sm text-ink-3">
              This key's prefix does not say how its addresses are made. Your signer shows it: addresses starting bc1q
              are wpkh, bc1p are tr.
            </p>
          </div>
        )}
      </div>
      <div className="grid content-start gap-4">
        <section className="grid gap-3 rounded-panel border border-rule bg-sheet p-4">
          <h2 className="m-0 text-md font-semibold">The descriptor this wallet will use</h2>
          {reading.descriptor ? (
            <>
              <DescriptorText>{reading.descriptor}</DescriptorText>
              <p className="m-0 text-sm text-ink-2">
                Check the script type and the key match what your signer shows. A wrong guess here gives an empty wallet,
                not an error.
              </p>
            </>
          ) : (
            <p className="m-0 text-sm text-ink-3">It appears here once the text above reads as a descriptor or a key.</p>
          )}
        </section>
        <Field label="Name" hint={`Only you see it. Left empty, it is ${fallbackName}.`}>
          {(props) => (
            <input {...props} className={inputClass} value={typedName} placeholder={fallbackName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" />
          )}
        </Field>
        <Button type="submit" variant="primary" wide disabled={!reading.descriptor || !!duplicate}>
          Continue to backup <Icon name="chev" className="size-[18px] -rotate-90" />
        </Button>
      </div>
      <Sheet open={scanning} onClose={() => setScanning(false)} title="Scan the descriptor">
        {scanning && (
          <QrScanner
            onResult={(result) => {
              setText(result);
              setScanning(false);
            }}
          />
        )}
        <p className="m-0 text-sm text-ink-3">Hold the QR code your signer shows inside the frame.</p>
      </Sheet>
    </form>
  );
}
