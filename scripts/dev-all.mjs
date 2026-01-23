// Starts `next dev` and the local cron scheduler together (single terminal).
// Usage: `npm run dev:all`

import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const nextBin = isWindows ? "npx.cmd" : "npx";
const nodeBin = isWindows ? "node.exe" : "node";

const next = spawn(nextBin, ["next", "dev"], { stdio: "inherit", shell: false });
const cron = spawn(nodeBin, ["scripts/cron-dev.mjs"], { stdio: "inherit", shell: false });

const shutdown = () => {
  next.kill("SIGINT");
  cron.kill("SIGINT");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

