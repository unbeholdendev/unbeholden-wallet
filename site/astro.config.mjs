import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://wallet.unbeholden.dev",
  build: { format: "file", inlineStylesheets: "never" },
  markdown: { syntaxHighlight: false },
});
