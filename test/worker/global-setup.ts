import { execSync } from "node:child_process";

// assets tests need a real build of the status page and the admin SPA
export default function setup() {
  execSync("bun run build", { stdio: "pipe" });
}
