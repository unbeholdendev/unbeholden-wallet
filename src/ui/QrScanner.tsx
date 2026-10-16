import { useEffect, useRef, useState } from "react";
import { readQr } from "../transport/qr";
import { Button } from "./kit";

type State = "starting" | "live" | "denied" | "no-camera";

const MAX_WIDTH = 720;
const INTERVAL_MS = 80;

/**
 * Reads QR codes from the camera. Calls `onResult` for every frame it decodes,
 * repeats included, so an animated UR can be collected part by part.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(onResult);
  const [state, setState] = useState<State>("starting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = onResult;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      const v = video.current;
      if (stopped || !v || !context) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        context.drawImage(v, 0, 0, canvas.width, canvas.height);
        const text = readQr(context.getImageData(0, 0, canvas.width, canvas.height));
        if (text !== null) latest.current(text);
      }
      timer = window.setTimeout(scan, INTERVAL_MS);
    };

    (async () => {
      setState("starting");
      if (!navigator.mediaDevices?.getUserMedia) return setState("no-camera");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (error) {
        const name = (error as DOMException).name;
        return setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no-camera");
      }
      if (stopped || !video.current) return stream.getTracks().forEach((t) => t.stop());
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setState("live");
      scan();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attempt]);

  const blocked = state === "denied" || state === "no-camera";
  return (
    <div className="grid gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-panel bg-[radial-gradient(120%_90%_at_50%_40%,#33413f_0%,#151c1d_70%)]">
        <video ref={video} muted playsInline className={`size-full object-cover ${state === "live" ? "" : "invisible"}`} />
        {!blocked &&
          ["top-[14%] left-[22%] border-r-0 border-b-0", "top-[14%] right-[22%] border-l-0 border-b-0", "bottom-[14%] left-[22%] border-r-0 border-t-0", "bottom-[14%] right-[22%] border-l-0 border-t-0"].map(
            (corner) => <span key={corner} aria-hidden="true" className={`absolute size-9 border-[3px] border-white ${corner}`} />,
          )}
        <p className="absolute top-3 left-3 m-0 flex items-center gap-1.5 rounded-[4px] bg-[rgb(0_0_0/0.45)] px-2 py-0.5 text-xs text-white">
          {state === "live" && <span className="size-2 rounded-full bg-[#f05f5f]" />}
          {state === "starting" ? "Asking for the camera" : state === "live" ? "Scanning" : "Camera off"}
        </p>
      </div>
      {state === "denied" && (
        <div role="alert" className="grid justify-items-start gap-2 text-sm text-ink-2">
          <p className="m-0">
            <b className="font-semibold text-ink">Camera access was refused.</b> Allow the camera for this site in your
            browser's site settings, then try again. Pasting the text works just as well.
          </p>
          <Button size="sm" icon="retry" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </div>
      )}
      {state === "no-camera" && (
        <p role="alert" className="m-0 text-sm text-ink-2">
          <b className="font-semibold text-ink">No camera is available here.</b> The browser found none it can use on
          this page. Paste the text instead.
        </p>
      )}
    </div>
  );
}
