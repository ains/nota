import { spawnSync } from "node:child_process";

const [version, ...extraArgs] = process.argv.slice(2);

if (!version || extraArgs.length > 0) {
  console.error("Usage: npm run bump-version -- <new-version>");
  process.exit(1);
}

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run(process.platform === "win32" ? "npm.cmd" : "npm", ["version", version]);
run("git", ["push", "--follow-tags"]);
