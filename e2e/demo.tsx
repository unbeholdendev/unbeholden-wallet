import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import { demoBackend, seedDemoVault } from "../src/backend/fixture";
import { vaultExists } from "../src/vault/vault";
import "../src/index.css";

/**
 * The real app against the fake server and the demo history, served by the
 * dev server only, for e2e tests and screenshots. Unlock with "demo passphrase".
 */
const CHEAP = { m: 8, t: 1, p: 1 };

if (!(await vaultExists())) await seedDemoVault("demo passphrase", CHEAP, "wss://fulcrum.tail4b2c1.ts.net:50004");

createRoot(document.getElementById("root")!).render(<App kdf={CHEAP} factory={() => demoBackend()} />);
