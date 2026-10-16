import { useEffect, useState } from "react";
import { APP_VERSION, registerServiceWorker } from "./pwa/register";

export function App() {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);
  useEffect(() => registerServiceWorker((apply) => setApplyUpdate(() => apply)), []);

  return (
    <main className="grid min-h-dvh place-items-center">
      <h1 className="text-2xl font-semibold">Bitcoin browser wallet</h1>
      <footer className="text-sm">
        Version {APP_VERSION}
        {applyUpdate && (
          <button type="button" onClick={applyUpdate}>
            Update ready: reload to use it
          </button>
        )}
      </footer>
    </main>
  );
}
