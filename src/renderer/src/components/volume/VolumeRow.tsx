import type { JSX } from "react";

/** One mixer row: mute checkbox, % readout, and a volume slider. */
export function VolumeRow({
  label,
  value,
  onChange,
  enabled,
  onToggle,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}): JSX.Element {
  return (
    <div className="vd-row">
      <div className="vd-row-label">
        <label className="vd-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              onToggle(e.target.checked);
              e.currentTarget.blur();
            }}
          />
          {label}
        </label>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => e.currentTarget.blur()}
      />
    </div>
  );
}
