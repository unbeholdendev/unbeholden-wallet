import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { electrumBackend } from "./backend/electrum";
import { esploraBackend } from "./backend/esplora";
import "./index.css";
import { log } from "./log";
import { APP_VERSION } from "./pwa/register";

log("start", { version: APP_VERSION });
addEventListener("error", (e) => log("uncaught", { message: e.message }));
addEventListener("unhandledrejection", (e) => log("unhandled", { message: String(e.reason?.message ?? e.reason) }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App factory={(url) => (/^https?:/.test(url) ? esploraBackend(url) : electrumBackend(url))} />
  </StrictMode>,
);
