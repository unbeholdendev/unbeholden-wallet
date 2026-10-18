import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { electrumBackend } from "./backend/electrum";
import { esploraBackend } from "./backend/esplora";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App factory={(url) => (/^https?:/.test(url) ? esploraBackend(url) : electrumBackend(url))} />
  </StrictMode>,
);
