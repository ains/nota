/** App-wide playback configuration. */

/**
 * Selectable playback speeds, ordered fastest → slowest so 1× heads the
 * dropdown. Playback is pitch-preserving: slowing down stretches time without
 * lowering pitch (see the Rubber Band path in Transport).
 */
export const PLAYBACK_SPEEDS = [1.0, 0.75, 0.5, 0.25] as const;

export const DEFAULT_PLAYBACK_RATE = 1.0;
