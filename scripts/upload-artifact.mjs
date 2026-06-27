/**
 * Upload the captured screenshots as a GitHub Actions artifact via the
 * artifacts API (`@actions/artifact`) — the only programmatic upload path
 * (the public REST API can list and download artifacts, but not create them).
 *
 * Runs inside a workflow step; it relies on the runner-provided
 * ACTIONS_RUNTIME_TOKEN / ACTIONS_RESULTS_URL env vars. The resulting
 * artifact URL is written to $GITHUB_OUTPUT as `artifact-url` for the comment
 * step to consume.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "screenshots",
);
const FILES = ["library.png", "project.png", "project-piano-roll.png"].map(
  (f) => resolve(OUT_DIR, f),
);

const client = new DefaultArtifactClient();
const { id } = await client.uploadArtifact("ui-screenshots", FILES, OUT_DIR);

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_OUTPUT } =
  process.env;
const url = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts/${id}`;

if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `artifact-url=${url}\n`);
console.log("Uploaded artifact:", url);
