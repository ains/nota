/** (De)serialization of .nota project files with version migration. */
import {
  PROJECT_VERSION,
  type AudioRef,
  type LoopRegion,
  type Note,
  type Project,
  type ProjectView,
} from "@shared/types/project";

export interface ProjectData {
  audio: AudioRef;
  notes: Note[];
  loopRegions: LoopRegion[];
  /** Absent for files saved before view state existed. */
  view?: ProjectView;
}

export function serializeProject(data: ProjectData): string {
  const project: Project = {
    version: PROJECT_VERSION,
    audio: data.audio,
    notes: data.notes,
    loopRegions: data.loopRegions,
    view: data.view,
  };
  return JSON.stringify(project, null, 2);
}

function parseView(raw: unknown): ProjectView | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const v = raw as Record<string, unknown>;
  if (
    typeof v.pxPerSecond === "number" &&
    typeof v.scrollSec === "number" &&
    typeof v.playheadSec === "number"
  ) {
    return {
      pxPerSecond: v.pxPerSecond,
      scrollSec: v.scrollSec,
      playheadSec: v.playheadSec,
    };
  }
  return undefined;
}

export class ProjectParseError extends Error {}

export function deserializeProject(json: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectParseError("File is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new ProjectParseError("File is not a Nota project");
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.version;
  if (typeof version !== "number") {
    throw new ProjectParseError("File is not a Nota project");
  }
  if (version > PROJECT_VERSION) {
    throw new ProjectParseError(
      `Project was saved by a newer version of Nota (file v${version}, app supports v${PROJECT_VERSION})`,
    );
  }
  // Future migrations: if (version === 1) raw = migrateV1toV2(raw) ...
  const project = obj as unknown as Project;
  if (!project.audio || !Array.isArray(project.notes)) {
    throw new ProjectParseError("Project file is missing required fields");
  }
  return {
    audio: project.audio,
    notes: project.notes,
    loopRegions: project.loopRegions ?? [],
    view: parseView(project.view),
  };
}
