import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "bun run preview --port 4173",
    url: "http://localhost:4173",
  },
});
