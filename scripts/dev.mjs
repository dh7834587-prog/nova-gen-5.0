import { spawn } from "node:child_process";

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
    }
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("server", "npx", ["tsx", "watch", "src/server/index.ts"]);
run("client", "npx", ["vite"]);
