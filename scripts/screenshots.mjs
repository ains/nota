/**
 * Render the Nota renderer in a real (headless) browser and capture the four
 * key UI states: the Library screen, the Project (editor) screen, the Project
 * screen with the piano roll open, and the Project screen with the audio-
 * controls drawer open. The last one zooms a "section" bar past the timeline
 * edge so it guards that loop regions stay clipped to the lane instead of
 * painting over the drawer.
 *
 * The app is served by `npm run dev:web` (a plain Vite dev server), so the
 * `window.__nota_dev` injection hook is available. We use it to load a
 * generated click track and inject notes — no Electron, no file dialogs, no
 * MIDI hardware required.
 *
 * Usage: node scripts/screenshots.mjs   (expects the dev server on :5199)
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const URL = process.env.SCREENSHOT_URL ?? "http://localhost:5199";
const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "screenshots",
);

// Fake library entries so the Library screen looks populated. These point at
// no real files; we only screenshot the screen, never click through.
const RECENT_PROJECTS = [
  {
    path: "/Users/demo/Music/Nocturne in E-flat.nota",
    name: "Nocturne in E-flat",
    audioFileName: "nocturne-eflat.wav",
    lastOpened: "2026-06-20T10:00:00.000Z",
  },
  {
    path: "/Users/demo/Music/Spring Sonata.nota",
    name: "Spring Sonata",
    audioFileName: "spring-sonata.wav",
    lastOpened: "2026-06-18T16:30:00.000Z",
  },
  {
    path: "/Users/demo/Music/Field Recording 04.nota",
    name: "Field Recording 04",
    audioFileName: "field-04.flac",
    lastOpened: "2026-06-12T09:15:00.000Z",
  },
];

async function gotoWithRetry(page, url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 2000 });
      return;
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  throw new Error(`Dev server never became reachable at ${url}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    // A failed requestMIDIAccess is expected and harmless in a browser.
    if (msg.type() === "error" && !msg.text().includes("requestMIDIAccess")) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  // Seed the library before any app code runs.
  await page.addInitScript((recents) => {
    localStorage.setItem("nota.recentProjects.v1", JSON.stringify(recents));
  }, RECENT_PROJECTS);

  await gotoWithRetry(page, URL);
  await page.waitForFunction(
    () => document.querySelector("#root")?.children.length > 0,
  );
  // Wait for the dev hook the rest of the flow depends on.
  await page.waitForFunction(() => Boolean(window.__nota_dev));

  // --- 1. Library ---
  await page.waitForSelector(".library-grid");
  await page.screenshot({ path: resolve(OUT_DIR, "library.png") });

  // --- 2. Project (editor) ---
  // Generate an ~8s mono WAV with periodic clicks so the waveform is non-trivial,
  // load it through the dev hook, then switch to the editor view.
  await page.evaluate(async () => {
    const sampleRate = 44100;
    const seconds = 8;
    const n = sampleRate * seconds;
    const bytesPerSample = 2;
    const dataLen = n * bytesPerSample;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);
    const writeStr = (off, s) => {
      for (let i = 0; i < s.length; i++)
        view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataLen, true);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      // Decaying tone bursts every 0.5s.
      const phase = t % 0.5;
      const env = Math.exp(-phase * 12);
      const sample =
        Math.sin(2 * Math.PI * 220 * t) * env * 0.6 +
        Math.sin(2 * Math.PI * 660 * t) * env * 0.2;
      view.setInt16(
        44 + i * 2,
        Math.max(-1, Math.min(1, sample)) * 32767,
        true,
      );
    }
    await window.__nota_dev.loadAudioBytes(buf, "demo.wav");
    window.__nota_dev.useSessionStore.getState().setView("editor");
  });

  await page.waitForFunction(
    () =>
      window.__nota_dev.useSessionStore.getState().view === "editor" &&
      !window.__nota_dev.useSessionStore.getState().audioLoading,
  );
  await page.waitForTimeout(400); // let the waveform canvas paint
  await page.screenshot({ path: resolve(OUT_DIR, "project.png") });

  // --- 3. Project + Piano Roll ---
  await page.evaluate(() => {
    const melody = [
      [60, 0.5],
      [62, 1.0],
      [64, 1.5],
      [65, 2.0],
      [67, 2.5],
      [65, 3.0],
      [64, 3.5],
      [62, 4.0],
      [60, 4.5],
      [64, 5.0],
      [67, 5.5],
      [72, 6.0],
    ];
    window.__nota_dev.useProjectStore.getState().addNotes(
      melody.map(([midi, onsetSec]) => ({
        midi,
        onsetSec,
        durationSec: 0.4,
        velocity: 90,
      })),
    );
    window.__nota_dev.useSessionStore.getState().setShowPianoRoll(true);
  });
  await page.waitForSelector(".roll-scroll");
  await page.waitForTimeout(400); // let the piano roll canvas paint
  await page.screenshot({ path: resolve(OUT_DIR, "project-piano-roll.png") });

  // --- 4. Project + audio-controls drawer ---
  // Open the audio-controls (volume) drawer and add a "section" that, at this
  // zoom, runs off the right edge of the timeline. The loop lane clips its
  // regions, so the section bar must stop at the drawer rather than paint over
  // it — this shot guards that behaviour against regressions.
  await page.evaluate(() => {
    const dev = window.__nota_dev;
    dev.useSessionStore.getState().setShowPianoRoll(false);
    dev.useSessionStore.getState().setShowVolumeDrawer(true);
    dev.useProjectStore.getState().addLoopRegion(0.5, 7.5);
    dev.useSessionStore
      .getState()
      .setViewport({ pxPerSecond: 200, scrollSec: 0 });
  });
  await page.waitForSelector(".volume-drawer");
  await page.waitForTimeout(400); // let the waveform redraw at the new zoom
  await page.screenshot({
    path: resolve(OUT_DIR, "project-volume-drawer.png"),
  });

  await browser.close();

  if (errors.length > 0) {
    console.error("Page reported errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("Captured 4 screenshots to", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
