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

// A constant condition, so the normal build drops the demo and its fake server.
if (import.meta.env.MODE === "demo") import("./demo");
else
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App factory={(url) => (/^https?:/.test(url) ? esploraBackend(url) : electrumBackend(url))} />
    </StrictMode>,
  );
