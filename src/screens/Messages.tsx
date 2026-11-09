import { HDKey } from "@scure/bip32";
import { useEffect, useRef, useState } from "react";
import { useWallet, useWalletSnapshot } from "../app/session";
import { qrPath } from "../transport/qr";
import { QrScanner } from "../ui/QrScanner";
import { Button, buttonClass, inputClass, linkClass, Notice } from "../ui/kit";
import { BIP32_VERSIONS } from "../wallet/extended-key";
import { armour, messageProblem, readSignature, signFile, signRequest, verifyMessage } from "../wallet/message";
import { NETWORKS, type Network } from "../wallet/network";
import { download } from "./Backup";

function SignatureInput({ onRead, onEdit }: { onRead: (text: string) => void; onEdit: () => void }) {
  const latest = useRef(onRead);
  const mounted = useRef(true);
  useEffect(() => { latest.current = onRead; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [text, setText] = useState("");
  const [scan, setScan] = useState(false);
  const [error, setError] = useState("");
  return <div className="grid gap-3">
    <Button className="justify-self-start" onClick={() => setScan(!scan)}>{scan ? "Stop camera" : "Scan signature QR"}</Button>
    {scan && <QrScanner onResult={onRead} />}
    <label className={`${buttonClass({})} cursor-pointer justify-self-start`}>Load signature file<input className="sr-only" type="file" accept=".txt,.sig,text/plain" onChange={async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try { const content = await file.text(); setError(""); if (mounted.current) latest.current(content); }
      catch { setError("Couldn't read this file. Try another file or paste the signature."); }
    }} /></label>
    <label className="grid gap-1.5 text-sm font-medium">Paste signature or armoured message<textarea className={`${inputClass} font-mono`} rows={4} value={text} spellCheck={false} onChange={(e) => { onEdit(); setText(e.target.value); }} /></label>
    <Button className="justify-self-start" disabled={!text.trim()} onClick={() => onRead(text)}>Check signature</Button>
    {error && <Notice tone="bad">{error}</Notice>}
  </div>;
}

export function SignMessage() {
  const { descriptor, network } = useWallet();
  const snapshot = useWalletSnapshot();
  const key = descriptor.keys[0]!;
  const fullOrigin = !!key.origin && key.origin.path.length === HDKey.fromExtendedKey(key.key, BIP32_VERSIONS[network]).depth;
  const [chosen, setChosen] = useState("");
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState(false);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const addresses = snapshot ? [...snapshot.addresses.receive, ...snapshot.addresses.change] : [];
  const selected = addresses.find((a) => a.address === chosen) ?? addresses[0];
  const problem = messageProblem(message);
  const reset = () => { setRequest(false); setSignature(""); setError(""); };
  const read = (text: string) => {
    setSignature("");
    try {
      const parsed = readSignature(text);
      if (parsed.message !== undefined && parsed.message !== message) throw new Error("The signed message differs from your message.");
      if (parsed.address !== undefined && parsed.address !== selected!.address) throw new Error("The signature is for another address.");
      if (!verifyMessage(selected!.address, message, parsed.signature, network).valid) throw new Error("The signature does not match this message and address.");
      setError(""); setSignature(parsed.signature);
    } catch (e) { setError((e as Error).message); }
  };
  const qr = request && selected ? qrPath(signRequest(message, selected.path)) : null;
  return <div className="grid max-w-[880px] gap-5">
    <h1 className="m-0 text-xl font-bold">Sign a message</h1>
    <a className={linkClass} href="#/verify-message">Verify someone else's message</a>
    {descriptor.multi ? <Notice tone="warn">Message signing is not supported for multisig wallets.</Notice> : descriptor.scriptType === "tr" ? <Notice tone="warn">Taproot message signing not supported yet</Notice> : !fullOrigin ? <Notice tone="warn">Import a descriptor with its key origin and full derivation path before signing a message.</Notice> : <>
      <p className="m-0 text-ink-2">Your air-gapped signer signs the message. Sharing a signature links this address to the message.</p>
      <label className="grid gap-1.5 text-sm font-medium">Wallet address and derivation path<select className={`${inputClass} min-w-0`} value={selected?.address ?? ""} onChange={(e) => { reset(); setChosen(e.target.value); }}>{addresses.map((a) => <option key={a.address} value={a.address}>{a.address} · {a.path}</option>)}</select></label>
      {selected && <p className="m-0 break-all font-mono text-sm">{selected.path}</p>}
      <label className="grid gap-1.5 text-sm font-medium">Message<textarea className={inputClass} rows={4} value={message} spellCheck={false} aria-invalid={!!message && !!problem} onChange={(e) => { reset(); setMessage(e.target.value); }} /></label>
      <p className="m-0 text-sm text-ink-3">Use 1–240 printable ASCII characters. Spaces count; line breaks are not allowed.</p>
      {message && problem && <Notice tone="bad">{problem}</Notice>}
      {!selected && <p>Opening wallet addresses.</p>}
      <Button variant="primary" className="justify-self-start" disabled={!selected || !!problem} onClick={() => setRequest(true)}>Export signing request</Button>
      {qr && selected && <section className="grid gap-4 rounded-panel border border-rule bg-sheet p-4">
        <h2 className="text-md font-bold">Sign on your device</h2>
        <p className="m-0 text-sm text-ink-2">Scan this single-frame request with a compatible signer, or load the text file on your Coldcard. Check the message and address on the device.</p>
        <div className="w-full max-w-[360px] bg-qr p-3"><svg className="aspect-square w-full" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="Message signing request QR" shapeRendering="crispEdges"><path d={qr.d} className="fill-qr-ink" /></svg></div>
        <Button className="justify-self-start" onClick={() => download(signFile(message, selected.path), "text/plain", "sign-message.txt")}>Download Coldcard text file</Button>
        <h2 className="text-md font-bold">Import the signature</h2>
        <SignatureInput onRead={read} onEdit={() => { setSignature(""); setError(""); }} />
      </section>}
      {error && <Notice tone="bad">{error}</Notice>}
      {signature && selected && <div className="grid gap-3"><Notice tone="ok">Signature verified against your message and address.</Notice><Button className="justify-self-start" onClick={() => download(armour(message, selected.address, signature), "text/plain", "signed-message.txt")}>Download armoured message</Button></div>}
    </>}
  </div>;
}

export function VerifyMessage() {
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [network, setNetwork] = useState<Network>("mainnet");
  const [result, setResult] = useState<{ valid: boolean; text: string } | null>(null);
  const read = (text: string) => {
    try {
      const parsed = readSignature(text);
      const nextAddress = parsed.address ?? address;
      const nextMessage = parsed.message ?? message;
      setAddress(nextAddress); setMessage(nextMessage);
      const checked = verifyMessage(nextAddress, nextMessage, parsed.signature, network);
      setResult({ valid: checked.valid, text: checked.valid ? `Valid ${checked.format} signature for this message and address.` : "The signature does not match this message and address." });
    } catch (e) { setResult({ valid: false, text: (e as Error).message }); }
  };
  return <div className="grid max-w-[720px] gap-5">
    <h1 className="m-0 text-xl font-bold">Verify a message</h1>
    <p className="m-0 text-ink-2">Verify legacy signatures or BIP322 simple signatures for P2WPKH and Taproot addresses. Verification runs in your browser.</p>
    <label className="grid gap-1.5 text-sm font-medium">Network<select className={inputClass} value={network} onChange={(e) => { setResult(null); setNetwork(e.target.value as Network); }}>{Object.keys(NETWORKS).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    <label className="grid gap-1.5 text-sm font-medium">Address<input className={inputClass} value={address} spellCheck={false} onChange={(e) => { setResult(null); setAddress(e.target.value); }} /></label>
    <label className="grid gap-1.5 text-sm font-medium">Message<textarea className={inputClass} rows={4} value={message} spellCheck={false} onChange={(e) => { setResult(null); setMessage(e.target.value); }} /></label>
    <SignatureInput onRead={read} onEdit={() => setResult(null)} />
    {result && <Notice tone={result.valid ? "ok" : "bad"}>{result.text}</Notice>}
  </div>;
}
