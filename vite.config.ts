import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

const commit =
  process.env.GIT_COMMIT ??
  execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const version = `${pkg.version}+${commit}`;

const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss: http: https:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function cspMeta(): Plugin {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: csp },
        injectTo: "head-prepend",
      },
    ],
  };
}

function serviceWorker(): Plugin {
  return {
    name: "service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [
        "./",
        ...Object.keys(bundle).filter((file) => file !== "index.html"),
        ...readdirSync("public"),
      ].sort();
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: [
          `const VERSION = ${JSON.stringify(version)};`,
          `const FILES = ${JSON.stringify(files)};`,
          readFileSync("src/pwa/sw.js", "utf8"),
        ].join("\n"),
      });
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(), cspMeta(), serviceWorker()],
  server: { host: "0.0.0.0", strictPort: true },
  preview: { host: "0.0.0.0", headers: { "Content-Security-Policy": csp } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
