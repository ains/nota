/**
 * Library of previously opened projects, persisted in localStorage. Each entry
 * points at a saved .nota file on disk; the library screen lists them and
 * re-opens them by path.
 */
export interface RecentProject {
  /** Absolute path to the .nota project file */
  path: string;
  /** Display name (file basename without extension) */
  name: string;
  /** Source audio file name, shown as a subtitle */
  audioFileName: string;
  /** ISO timestamp of the last time it was opened */
  lastOpened: string;
}

const KEY = "nota.recentProjects.v1";
const MAX = 50;

export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentProject[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: RecentProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage unavailable or full — recents are a convenience, not critical.
  }
}

/** Upsert an entry, moving it to the front with a fresh timestamp. */
export function addRecentProject(
  entry: Omit<RecentProject, "lastOpened">,
): void {
  const rest = loadRecentProjects().filter((p) => p.path !== entry.path);
  save([{ ...entry, lastOpened: new Date().toISOString() }, ...rest]);
}

export function removeRecentProject(path: string): void {
  save(loadRecentProjects().filter((p) => p.path !== path));
}
