/**
 * Build the native demucs CLI from demucs-rs
 * (https://github.com/nikhilunni/demucs-rs) and stage the binary at
 * resources/demucs/, where packaging picks it up (resources/** ships asar-
 * unpacked) and `npm run dev` finds it. The app prefers this binary for stem
 * separation — it is much faster than the in-renderer WebGPU WASM path — and
 * falls back to WASM when it is absent, so running this script is optional in
 * development but mandatory for release builds (the Release workflow runs it).
 *
 * Requires git and a Rust toolchain (https://rustup.rs). Overrides:
 *   DEMUCS_RS_REPO  source repository (default: nikhilunni/demucs-rs)
 *   DEMUCS_RS_REF   tag or branch to build (default: pinned tag below)
 *
 * Usage: npm run build:demucs
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO =
  process.env.DEMUCS_RS_REPO ?? "https://github.com/nikhilunni/demucs-rs";
// Bump deliberately; keep the release workflow's cache key in sync.
const REF = process.env.DEMUCS_RS_REF ?? "v0.3.4";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, ".cache", "demucs-rs-src");
// Outside the (freshly re-cloned) checkout so CI can cache compiled deps.
const TARGET_DIR = join(ROOT, ".cache", "demucs-rs-target");
const BINARY = process.platform === "win32" ? "demucs.exe" : "demucs";
const STAGED = join(ROOT, "resources", "demucs", BINARY);

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

try {
  execFileSync("cargo", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    "cargo not found — install a Rust toolchain (https://rustup.rs) to " +
      "build the native demucs CLI, or skip it: the app falls back to " +
      "WebGPU stem separation when the binary is absent.",
  );
  process.exit(1);
}

console.log(`Building demucs CLI from ${REPO} at ${REF}…`);
rmSync(SRC_DIR, { recursive: true, force: true });
run("git", ["clone", "--depth", "1", "--branch", REF, REPO, SRC_DIR]);
run("cargo", ["build", "--release", "-p", "demucs-cli"], {
  cwd: SRC_DIR,
  env: { ...process.env, CARGO_TARGET_DIR: TARGET_DIR },
});

mkdirSync(dirname(STAGED), { recursive: true });
copyFileSync(join(TARGET_DIR, "release", BINARY), STAGED);
if (process.platform !== "win32") chmodSync(STAGED, 0o755);
console.log(`Staged ${STAGED} (demucs-rs ${REF})`);
