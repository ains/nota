/**
 * Assemble the static landing page into website/dist/ for GitHub Pages.
 *
 * The only thing we template is the per-platform download links. In CI the
 * Website workflow passes NOTA_VERSION (the published release tag, e.g.
 * "v0.0.4"), and we point the buttons straight at that release's macOS DMG and
 * Windows installer. Without a version — local previews, manual runs — we fall
 * back to the latest-release page so the links always resolve to something real.
 *
 * Usage: node website/build.mjs   (then open website/dist/index.html)
 */
import { readFile, writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");

// Strip a leading "v" so "v0.0.4" and "0.0.4" both work.
const version = (process.env.NOTA_VERSION ?? "").trim().replace(/^v/, "");

// Mirrors electron-builder.yml artifact names and the Release workflow's
// targets: dmg `${name}-${version}-${arch}` (arm64 only) and nsis
// `${name}-${version}-setup`. Keep these in sync if either changes.
const releaseBase = `https://github.com/ains/nota/releases/download/v${version}`;
const latestRelease = "https://github.com/ains/nota/releases/latest";
const macDownloadUrl = version
  ? `${releaseBase}/Nota-${version}-arm64.dmg`
  : latestRelease;
const winDownloadUrl = version
  ? `${releaseBase}/Nota-${version}-setup.exe`
  : latestRelease;

const ASSETS = [
  ["screenshot.png", resolve(here, "screenshot.png")],
  ["icon.svg", resolve(here, "..", "resources", "icon.svg")],
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const html = await readFile(resolve(here, "index.html"), "utf8");
await writeFile(
  resolve(dist, "index.html"),
  html
    .replaceAll("%DOWNLOAD_URL_MAC%", macDownloadUrl)
    .replaceAll("%DOWNLOAD_URL_WIN%", winDownloadUrl),
);

await Promise.all(
  ASSETS.map(([name, source]) => copyFile(source, resolve(dist, name))),
);

// Tell GitHub Pages not to run the files through Jekyll.
await writeFile(resolve(dist, ".nojekyll"), "");

console.log(
  `Built website/dist (macOS → ${macDownloadUrl}, Windows → ${winDownloadUrl})`,
);
