/**
 * State of the stem-separation pipeline, modelled as a small immutable value
 * with named constructors and predicates. Call sites read as intent
 * (`job.inProgress()`, `job.cancellable()`) instead of raw phase comparisons.
 */
export type StemJobPhase =
  | "idle"
  | "downloading"
  | "separating"
  | "saving"
  | "error";

export class StemJobState {
  private constructor(
    readonly phase: StemJobPhase,
    /** Completed fraction 0..1 while downloading/separating; null otherwise. */
    readonly progress: number | null = null,
    /** Failure message; only meaningful when {@link hasError} is true. */
    readonly message = "",
  ) {}

  /** Nothing running — the initial state, or after a run ends or is cancelled. */
  static idle(): StemJobState {
    return new StemJobState("idle");
  }

  /** Fetching the model weights. */
  static downloading(progress: number | null): StemJobState {
    return new StemJobState("downloading", progress);
  }

  /** Running inference. */
  static separating(progress: number | null): StemJobState {
    return new StemJobState("separating", progress);
  }

  /** Writing the separated stems into the project bundle. */
  static saving(): StemJobState {
    return new StemJobState("saving");
  }

  /** The last run failed with a message. */
  static error(message: string): StemJobState {
    return new StemJobState("error", null, message);
  }

  /** A separation run is underway (downloading, separating, or saving). */
  inProgress(): boolean {
    return (
      this.phase === "downloading" ||
      this.phase === "separating" ||
      this.phase === "saving"
    );
  }

  /** The run can still be cancelled — everything up to, but not including, saving. */
  cancellable(): boolean {
    return this.phase === "downloading" || this.phase === "separating";
  }

  /** The last run ended in failure. */
  hasError(): boolean {
    return this.phase === "error";
  }
}
