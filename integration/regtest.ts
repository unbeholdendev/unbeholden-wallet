import { execFileSync } from "node:child_process";

export function setup(): void {
  execFileSync("scripts/regtest/up.sh", { stdio: "inherit" });
}

export function teardown(): void {
  execFileSync("scripts/regtest/down.sh", { stdio: "inherit" });
}
