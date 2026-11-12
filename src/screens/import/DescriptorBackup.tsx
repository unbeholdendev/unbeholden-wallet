import { Button } from "../../ui/kit";
import { useToast } from "../../ui/toast";
import type { Network } from "../../wallet/network";

export function DescriptorText({ children }: { children: string }) {
  return (
    <p className="m-0 rounded-control border border-rule bg-sunk px-3 py-2.5 font-mono text-[0.86em] leading-relaxed break-all text-ink select-all">
      {children}
    </p>
  );
}

/** The descriptor with its copy and download buttons. */
export function DescriptorBackup({
  name,
  network,
  descriptor,
  onSaved,
}: {
  name: string;
  network: Network;
  descriptor: string;
  onSaved?: () => void;
}) {
  const toast = useToast();

  const copy = async () => {
    await navigator.clipboard.writeText(descriptor);
    onSaved?.();
    toast("Descriptor copied");
  };

  const download = () => {
    const body = `${name}\n${network}\n\n${descriptor}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    link.download = `${name.replace(/[^\w-]+/g, "-")}-descriptor.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    onSaved?.();
  };

  return (
    <>
      <DescriptorText>{descriptor}</DescriptorText>
      <div className="flex flex-wrap gap-2">
        <Button icon="copy" onClick={copy}>
          Copy
        </Button>
        <Button icon="file" onClick={download}>
          Download as a text file
        </Button>
      </div>
    </>
  );
}
