/**
 * Lookahead scheduler ("A Tale of Two Clocks"): a coarse JS timer decides
 * WHAT to schedule; WHEN is always an exact AudioContext time, so timer
 * jitter up to (SCHEDULE_AHEAD − tick interval) is inaudible.
 *
 * Handles loop unfolding: a note at timeline position n inside loop [Ls, Le)
 * sounds at ctxOn = startCtx + (n − songOffset) + k·(Le − Ls) for every loop
 * pass k whose occurrence falls inside the scheduling horizon.
 */
import type { Note } from "@shared/types/project";
import type { Transport } from "./Transport";
import type { Sampler } from "./Sampler";

const TICK_MS = 50;
const SCHEDULE_AHEAD_SEC = 0.25;

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Time-sorted by onset. */
  private notes: Note[] = [];
  private muted = false;
  /** Keys of (noteId, loopPass) already scheduled, pruned as voices end. */
  private issued = new Set<string>();

  constructor(
    private transport: Transport,
    private sampler: Sampler,
  ) {
    transport.onChange(() => this.onTransportChange());
  }

  setNotes(notes: readonly Note[]): void {
    this.notes = [...notes].sort((x, y) => x.onsetSec - y.onsetSec);
    // Conservative: drop pending voices so edits/deletes take effect immediately.
    this.resetPending();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.resetPending();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private onTransportChange(): void {
    this.resetPending();
    if (this.transport.isPlaying) {
      this.startTimer();
    } else {
      this.stopTimer();
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private resetPending(): void {
    this.sampler.cancelAllScheduled();
    this.issued.clear();
  }

  private tick(): void {
    if (this.muted || !this.transport.isPlaying || this.notes.length === 0)
      return;

    const ctx = this.transport.ctx;
    const { startCtx, songOffset } = this.transport.anchor;
    const speed = this.transport.speed;
    const loop = this.transport.loopSpan;
    const now = ctx.currentTime;
    const horizon = now + SCHEDULE_AHEAD_SEC;

    if (!loop) {
      for (const note of this.notes) {
        const ctxOn = startCtx + (note.onsetSec - songOffset) / speed;
        if (ctxOn >= horizon) break;
        if (ctxOn < now - 0.02) continue;
        this.issue(note, 0, ctxOn);
      }
      return;
    }

    const { start: Ls, end: Le } = loop;
    const len = Le - Ls;
    // Pass k occupies elapsed range [k·len + (Ls − songOffset), …): find the
    // passes whose ctx-time window intersects [now, horizon).
    const elapsedNow = (now - startCtx) * speed;
    const elapsedHorizon = (horizon - startCtx) * speed;
    const kMin = Math.max(0, Math.floor((elapsedNow + songOffset - Le) / len));
    const kMax = Math.ceil((elapsedHorizon + songOffset - Ls) / len);

    for (let k = kMin; k <= kMax; k++) {
      for (const note of this.notes) {
        if (note.onsetSec < Ls || note.onsetSec >= Le) continue;
        // First pass (k=0) plays from songOffset, which may start mid-loop.
        if (k === 0 && note.onsetSec < songOffset) continue;
        const ctxOn = startCtx + (note.onsetSec - songOffset + k * len) / speed;
        if (ctxOn < now - 0.02 || ctxOn >= horizon) continue;
        this.issue(note, k, ctxOn);
      }
    }
  }

  private issue(note: Note, pass: number, ctxOn: number): void {
    const key = `${note.id}:${pass}`;
    if (this.issued.has(key)) return;
    this.issued.add(key);
    this.sampler.scheduleNote(
      key,
      note.midi,
      note.velocity,
      ctxOn,
      note.durationSec / this.transport.speed,
    );
  }
}
