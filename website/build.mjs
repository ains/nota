/**
 * Assemble the static landing page into website/dist/ for GitHub Pages.
 *
 * The only thing we template is the "Download for macOS" link. In CI the
 * Website workflow passes NOTA_VERSION (the published release tag, e.g.
 * "v0.0.4"), and we point the button straight at that release's macOS DMG.
 * Without a version — local previews, manual runs — we fall back to the
 * latest-release page so the link always resolves to something real.
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

// Mirrors electron-builder.yml: dmg artifactName `${name}-${version}-${arch}`,
// and the Release workflow builds arm64 only. Keep these in sync if either
// the artifact name or the target architecture changes.
const downloadUrl = version
  ? `https://github.com/ains/nota/releases/download/v${version}/Nota-${version}-arm64.dmg`
  : "https://github.com/ains/nota/releases/latest";

const ASSETS = ["screenshot.png", "icon.svg"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const html = await readFile(resolve(here, "index.html"), "utf8");
await writeFile(
  resolve(dist, "index.html"),
  html.replaceAll("%DOWNLOAD_URL%", downloadUrl),
);

await Promise.all(
  ASSETS.map((name) => copyFile(resolve(here, name), resolve(dist, name))),
);

// Tell GitHub Pages not to run the files through Jekyll.
await writeFile(resolve(dist, ".nojekyll"), "");

console.log(`Built website/dist (download → ${downloadUrl})`);
