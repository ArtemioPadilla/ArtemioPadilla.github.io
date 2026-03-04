import type { FunctionalComponent } from "preact";

interface StepControlsProps {
  stepIndex: number;
  totalSteps: number;
  onStepChange: (index: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentEvent: string;
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  call: { label: "call", color: "var(--color-accent)" },
  line: { label: "line", color: "var(--color-primary)" },
  return: { label: "return", color: "#a78bfa" },
  exception: { label: "exception", color: "#f87171" },
};

const StepControls: FunctionalComponent<StepControlsProps> = ({
  stepIndex,
  totalSteps,
  onStepChange,
  isPlaying,
  onTogglePlay,
  currentEvent,
}) => {
  const isFirst = stepIndex <= 0;
  const isLast = stepIndex >= totalSteps - 1;
  const eventInfo = EVENT_LABELS[currentEvent] ?? {
    label: currentEvent,
    color: "var(--color-text-muted)",
  };

  const btnBase =
    "flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed";
  const btnDefault = `${btnBase} text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-heading)]`;

  return (
    <div class="flex flex-wrap items-center gap-3 px-4 py-2.5">
      {/* Navigation buttons */}
      <div class="flex items-center gap-1">
        <button
          class={btnDefault}
          disabled={isFirst}
          onClick={() => onStepChange(0)}
          title="First step"
          aria-label="First step"
        >
          ⏮
        </button>
        <button
          class={btnDefault}
          disabled={isFirst}
          onClick={() => onStepChange(stepIndex - 1)}
          title="Previous step"
          aria-label="Previous step"
        >
          ◀
        </button>
        <button
          class={btnDefault}
          disabled={isLast}
          onClick={() => onStepChange(stepIndex + 1)}
          title="Next step"
          aria-label="Next step"
        >
          ▶
        </button>
        <button
          class={btnDefault}
          disabled={isLast}
          onClick={() => onStepChange(totalSteps - 1)}
          title="Last step"
          aria-label="Last step"
        >
          ⏭
        </button>
      </div>

      {/* Auto-play toggle */}
      <button
        class={`${btnBase} px-3 w-auto ${
          isPlaying
            ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
            : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-heading)]"
        }`}
        onClick={onTogglePlay}
        disabled={isLast && !isPlaying}
        title={isPlaying ? "Pause" : "Auto-play"}
        aria-label={isPlaying ? "Pause" : "Auto-play"}
      >
        {isPlaying ? "⏸" : "▶▶"}
      </button>

      {/* Step counter */}
      <span
        class="text-xs text-[var(--color-text-muted)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        Step{" "}
        <span class="font-semibold text-[var(--color-heading)]">
          {stepIndex + 1}
        </span>{" "}
        of {totalSteps}
      </span>

      {/* Event badge */}
      <span
        class="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          color: eventInfo.color,
          backgroundColor: `color-mix(in srgb, ${eventInfo.color} 15%, transparent)`,
          border: `1px solid color-mix(in srgb, ${eventInfo.color} 30%, transparent)`,
        }}
      >
        {eventInfo.label}
      </span>
    </div>
  );
};

export default StepControls;
