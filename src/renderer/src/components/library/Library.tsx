import { useState } from "react";
import type { JSX } from "react";
import {
  loadRecentProjects,
  removeRecentProject,
  type RecentProject,
} from "../../persistence/recentProjects";
import {
  openProject,
  openProjectByPath,
  createProjectFromAudioFile,
} from "../../state/appActions";

const AUDIO_EXTS = ["wav", "mp3", "flac", "ogg", "m4a", "aac", "aiff", "aif"];

function isAudioFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext !== undefined && AUDIO_EXTS.includes(ext);
}

/**
 * The opening screen: a grid of previously opened projects plus a drop target.
 * Dropping an audio file starts a new project; clicking a card re-opens one.
 */
export function Library(): JSX.Element {
  const [recents, setRecents] = useState<RecentProject[]>(loadRecentProjects);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      isAudioFile(f.name),
    );
    if (file) void createProjectFromAudioFile(file);
  };

  const remove = (e: React.MouseEvent, path: string): void => {
    e.stopPropagation();
    removeRecentProject(path);
    setRecents(loadRecentProjects());
  };

  return (
    <div
      className={`library${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <h1 className="library-title">Library</h1>
      <p className="library-hint">
        Drag an audio file here to start a new project, or open an existing one.
      </p>

      <div className="library-grid">
        <button
          className="project-card project-card-open"
          onClick={() => void openProject()}
          title="Browse for a project file"
        >
          <span className="project-name">Open project…</span>
          <span className="project-audio">Browse for a .nota file</span>
        </button>
        {recents.map((p) => (
          <button
            key={p.path}
            className="project-card"
            onClick={() => void openProjectByPath(p.path)}
            title={p.path}
          >
            <span className="project-name">{p.name}</span>
            <span className="project-audio">{p.audioFileName}</span>
            <span className="project-date">
              {new Date(p.lastOpened).toLocaleDateString()}
            </span>
            <span
              className="project-remove"
              title="Remove from library"
              onClick={(e) => remove(e, p.path)}
            >
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
