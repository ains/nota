/**
 * Document state: notes, loop regions, audio reference.
 * Undo/redo (zundo) tracks only { notes, loopRegions } — viewport and
 * playback are not undoable.
 */
import { create } from "zustand";
import { temporal } from "zundo";
import { nanoid } from "nanoid";
import type {
  AudioRef,
  LoopRegion,
  Note,
  StoredStems,
} from "@shared/types/project";

export interface ProjectState {
  audio: AudioRef | null;
  notes: Note[];
  loopRegions: LoopRegion[];
  /** Separated-stem metadata; the stem audio lives in the bundle. */
  stems: StoredStems | null;
  /** Path of the open .nota project bundle, null = never saved */
  projectPath: string | null;
  dirty: boolean;

  setAudio(audio: AudioRef | null): void;
  setStems(stems: StoredStems | null): void;
  addNotes(notes: Omit<Note, "id">[]): Note[];
  updateNotes(updates: Map<string, Partial<Omit<Note, "id">>>): void;
  deleteNotes(ids: ReadonlySet<string>): void;
  addLoopRegion(startSec: number, endSec: number): LoopRegion;
  updateLoopRegion(id: string, patch: Partial<Omit<LoopRegion, "id">>): void;
  deleteLoopRegion(id: string): void;
  loadProject(data: {
    audio: AudioRef;
    notes: Note[];
    loopRegions: LoopRegion[];
    stems: StoredStems | null;
    projectPath: string;
  }): void;
  newProject(audio: AudioRef): void;
  markSaved(path: string, audioAbsolutePath?: string): void;
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set) => ({
      audio: null,
      notes: [],
      loopRegions: [],
      stems: null,
      projectPath: null,
      dirty: false,

      setAudio: (audio) => set({ audio, dirty: true }),

      setStems: (stems) => set({ stems, dirty: true }),

      addNotes: (newNotes) => {
        const withIds = newNotes.map((n) => ({ ...n, id: nanoid(10) }));
        set((s) => ({ notes: [...s.notes, ...withIds], dirty: true }));
        return withIds;
      },

      updateNotes: (updates) =>
        set((s) => ({
          notes: s.notes.map((n) => {
            const patch = updates.get(n.id);
            return patch ? { ...n, ...patch } : n;
          }),
          dirty: true,
        })),

      deleteNotes: (ids) =>
        set((s) => ({
          notes: s.notes.filter((n) => !ids.has(n.id)),
          dirty: true,
        })),

      addLoopRegion: (startSec, endSec) => {
        const region: LoopRegion = {
          id: nanoid(10),
          name: `Section ${useProjectStore.getState().loopRegions.length + 1}`,
          startSec,
          endSec,
        };
        set((s) => ({ loopRegions: [...s.loopRegions, region], dirty: true }));
        return region;
      },

      updateLoopRegion: (id, patch) =>
        set((s) => ({
          loopRegions: s.loopRegions.map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
          dirty: true,
        })),

      deleteLoopRegion: (id) =>
        set((s) => ({
          loopRegions: s.loopRegions.filter((r) => r.id !== id),
          dirty: true,
        })),

      loadProject: (data) =>
        set({
          audio: data.audio,
          notes: data.notes,
          loopRegions: data.loopRegions,
          stems: data.stems,
          projectPath: data.projectPath,
          dirty: false,
        }),

      newProject: (audio) =>
        set({
          audio,
          notes: [],
          loopRegions: [],
          stems: null,
          projectPath: null,
          dirty: true,
        }),

      // After a save-as the audio now lives inside the new bundle; repoint the
      // ref at that copy so later saves and reloads no longer touch the source.
      markSaved: (path, audioAbsolutePath) =>
        set((s) => ({
          projectPath: path,
          dirty: false,
          audio:
            audioAbsolutePath && s.audio
              ? { ...s.audio, absolutePath: audioAbsolutePath }
              : s.audio,
        })),
    }),
    {
      partialize: (s) => ({ notes: s.notes, loopRegions: s.loopRegions }),
      equality: (a, b) =>
        a.notes === b.notes && a.loopRegions === b.loopRegions,
      limit: 200,
    },
  ),
);

export const projectTemporal = useProjectStore.temporal;

export function undo(): void {
  projectTemporal.getState().undo();
}

export function redo(): void {
  projectTemporal.getState().redo();
}

/**
 * Drags never write intermediate states to the store (the piano roll renders
 * an ephemeral delta from sessionStore instead), so a completed drag is one
 * set() and therefore one undo entry. Loading/creating a project clears
 * history entirely.
 */
export function clearHistory(): void {
  projectTemporal.getState().clear();
}
