import { defineConfig } from "@playwright/test";

export const DEMO_URL = "http://localhost:4174/e2e/demo.html";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: [
    {
      command: "bun run preview --port 4173",
      url: "http://localhost:4173",
    },
    // The demo page runs the app against the fake server; only the dev server serves it, so it never reaches the build.
    {
      command: "bunx vite --port 4174",
      url: DEMO_URL,
    },
  ],
});
