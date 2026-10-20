import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { demoBackend, seedDemoVault } from "./backend/fixture";
import { DEFAULT_KDF, vaultExists } from "./vault/vault";

if (!(await vaultExists())) await seedDemoVault(null, DEFAULT_KDF, "wss://demo");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <p role="note" className="m-0 bg-warn-tint px-4 py-2 text-center text-sm text-warn">
      Demo wallet with made-up history. Its keys are public: never send bitcoin to its addresses.
    </p>
    <App factory={() => demoBackend()} />
  </StrictMode>,
);
