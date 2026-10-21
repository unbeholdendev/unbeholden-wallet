import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const version =
  process.env.APP_VERSION ??
  execSync("git describe --tags --always", { encoding: "utf8" }).trim();

const csp = (mode: string) => [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src blob:",
  "font-src 'self'",
  mode === "demo" ? "connect-src 'self'" : "connect-src 'self' ws: wss: http: https:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function cspMeta(mode: string): Plugin {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: csp(mode) },
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

export default defineConfig(({ mode }) => ({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    tailwindcss(),
    cspMeta(mode),
    serviceWorker(),
    { ...basicSsl(), apply: (_, env) => env.command === "serve" && !env.isPreview },
  ],
  server: {
    host: "0.0.0.0",
    strictPort: true,
    proxy: { "/electrum": { target: "ws://127.0.0.1:50003", ws: true, rewrite: () => "/" } },
  },
  build: { outDir: mode === "demo" ? "dist-demo" : "dist" },
  preview: { host: "0.0.0.0", headers: { "Content-Security-Policy": csp(mode) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
