/**
 * Native stem separation via the Rust-built demucs CLI
 * (https://github.com/nikhilunni/demucs-rs), which is much faster than the
 * in-renderer WebGPU WASM path. The binary is staged at resources/demucs/ by
 * `npm run build:demucs` — always in release CI, optionally in dev — and the
 * renderer falls back to WASM whenever it is absent.
 *
 * The CLI downloads and caches the model weights itself on first use, decodes
 * the source audio file directly, and writes one `<stem>.wav` per stem (at
 * the source sample rate) into a temp directory that is read back and cleaned
 * up here. One job at a time; cancellation kills the child process.
 */
import { app, ipcMain } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  IPC,
  type NativeSeparationResult,
  type NativeStemPhase,
  type StemFile,
} from "../shared/ipc";
import { demucsPhaseForLine } from "./demucsStderr";

const BINARY_NAME = process.platform === "win32" ? "demucs.exe" : "demucs";
/** How many trailing stderr lines to keep for error reporting. */
const STDERR_TAIL = 20;

/**
 * Locate the demucs binary: the NOTA_DEMUCS_CLI env override (dev
 * convenience), then the staged resources/demucs/ copy. In a packaged app
 * resources/ lives outside the asar (asarUnpack), so the archive path is
 * rewritten to its unpacked twin.
 */
export function demucsCliPath(): string | null {
  const candidates = [
    process.env.NOTA_DEMUCS_CLI,
    join(app.getAppPath(), "resources", "demucs", BINARY_NAME).replace(
      "app.asar",
      "app.asar.unpacked",
    ),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

interface ActiveJob {
  child: ChildProcess;
  cancelled: boolean;
}

let activeJob: ActiveJob | null = null;
/** Set for the whole handler (spawn is preceded by an await); one job at a time. */
let jobRunning = false;

interface CliRun {
  cancelled: boolean;
  code: number | null;
  /** Trailing plain stderr lines (progress bars are hidden on pipes). */
  stderr: string[];
}

function runCli(
  binary: string,
  sourcePath: string,
  stems: string[],
  outDir: string,
  modelId: string,
  onPhase: (phase: NativeStemPhase) => void,
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [sourcePath, "-m", modelId, "-s", stems.join(","), "-o", outDir],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const job: ActiveJob = { child, cancelled: false };
    activeJob = job;

    const stderr: string[] = [];
    let pending = "";
    let phase: NativeStemPhase | null = null;
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        stderr.push(line);
        if (stderr.length > STDERR_TAIL) stderr.shift();
        const next = demucsPhaseForLine(line);
        if (next && next !== phase) {
          phase = next;
          onPhase(next);
        }
      }
    });

    // 'error' (spawn failure) and 'close' can both fire; settle once.
    let settled = false;
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      activeJob = null;
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      activeJob = null;
      resolve({ cancelled: job.cancelled, code, stderr });
    });
  });
}

export function registerDemucsIpc(): void {
  // Synchronous: the preload bridge reads this once so the renderer can pick
  // its separation path without an async round trip. Just two stat calls.
  ipcMain.on(IPC.nativeStemsAvailable, (e) => {
    e.returnValue = demucsCliPath() !== null;
  });

  ipcMain.handle(IPC.cancelNativeSeparation, (): void => {
    if (!activeJob) return;
    activeJob.cancelled = true;
    activeJob.child.kill();
  });

  ipcMain.handle(
    IPC.separateStemsNative,
    async (
      e,
      sourcePath: string,
      stems: string[],
      modelId: string,
    ): Promise<NativeSeparationResult> => {
      const binary = demucsCliPath();
      if (!binary) {
        return { status: "error", message: "Native separator not available" };
      }
      if (jobRunning) {
        return { status: "error", message: "A separation is already running" };
      }
      jobRunning = true;

      const outDir = await mkdtemp(join(tmpdir(), "nota-stems-"));
      try {
        const run = await runCli(
          binary,
          sourcePath,
          stems,
          outDir,
          modelId,
          (phase) => {
            if (!e.sender.isDestroyed()) {
              e.sender.send(IPC.nativeStemProgress, phase);
            }
          },
        );
        if (run.cancelled) return { status: "cancelled" };
        if (run.code !== 0) {
          return {
            status: "error",
            message: `demucs exited with code ${run.code}: ${
              run.stderr.slice(-5).join(" | ") || "(no output)"
            }`,
          };
        }
        const files: StemFile[] = await Promise.all(
          stems.map(async (stem) => {
            const fileName = `${stem}.wav`;
            const buf = await readFile(join(outDir, fileName));
            // Slice to a standalone ArrayBuffer so structured clone transfers
            // cleanly (same as the project-stem read path).
            const bytes = buf.buffer.slice(
              buf.byteOffset,
              buf.byteOffset + buf.byteLength,
            );
            return { fileName, bytes };
          }),
        );
        return { status: "done", files };
      } catch (err) {
        return {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        jobRunning = false;
        rm(outDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
}
