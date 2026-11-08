import { execSync } from "node:child_process";

// assets test needs a real build of the status page
export default function setup() {
  execSync("bunx vite build", { stdio: "pipe" });
}
