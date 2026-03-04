import type { FunctionalComponent } from "preact";
import type { StackFrame, PrimValue } from "./types";

interface StackPanelProps {
  stack: StackFrame[];
}

const VALUE_COLORS: Record<string, string> = {
  int: "#60a5fa",
  float: "#60a5fa",
  str: "#34d399",
  bool: "#fb923c",
  none: "#a1a1aa",
};

function renderPrimValue(val: PrimValue): preact.JSX.Element {
  if (val.type === "ref") {
    return (
      <span
        class="ref-dot inline-block h-3 w-3 rounded-full"
        style={{ backgroundColor: "var(--color-primary)" }}
        data-ref-id={val.id}
      />
    );
  }

  const color = VALUE_COLORS[val.type] ?? "var(--color-text)";
  let display: string;

  switch (val.type) {
    case "none":
      display = "None";
      break;
    case "bool":
      display = val.value ? "True" : "False";
      break;
    case "str":
      display = `"${val.value}"`;
      break;
    case "int":
    case "float":
      display = String(val.value);
      break;
    default:
      display = "???";
  }

  return (
    <span class="font-mono text-xs" style={{ color }}>
      {display}
    </span>
  );
}

const StackPanel: FunctionalComponent<StackPanelProps> = ({ stack }) => {
  if (stack.length === 0) {
    return (
      <div class="p-4">
        <p class="text-xs text-[var(--color-text-muted)]/50 italic">
          No active frames
        </p>
      </div>
    );
  }

  return (
    <div class="stack-panel flex flex-col gap-2 p-3">
      <h3 class="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        Frames
      </h3>
      {stack.map((frame, i) => (
        <div
          key={`${frame.funcName}-${i}`}
          class="rounded-lg border bg-[var(--color-bg)]/50"
          style={{
            borderColor: frame.isHighlighted
              ? "var(--color-primary)"
              : "var(--color-border)",
            borderLeftWidth: frame.isHighlighted ? "3px" : "1px",
          }}
        >
          {/* Frame header */}
          <div
            class="border-b px-3 py-1.5 text-xs font-semibold"
            style={{
              borderColor: frame.isHighlighted
                ? "color-mix(in srgb, var(--color-primary) 30%, transparent)"
                : "var(--color-border)",
              color: frame.isHighlighted
                ? "var(--color-primary)"
                : "var(--color-heading)",
            }}
          >
            {frame.funcName}
            <span class="ml-2 text-[10px] font-normal text-[var(--color-text-muted)]">
              :L{frame.lineNumber}
            </span>
          </div>

          {/* Variables */}
          <div class="px-3 py-1.5">
            {frame.locals.length === 0 ? (
              <p class="text-[10px] text-[var(--color-text-muted)]/40 italic">
                no variables
              </p>
            ) : (
              frame.locals.map((v) => (
                <div
                  key={v.name}
                  class="flex items-center justify-between gap-2 py-0.5"
                >
                  <span class="shrink-0 text-xs font-medium text-[var(--color-heading)]">
                    {v.name}
                  </span>
                  <span class="text-right">{renderPrimValue(v.value)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export { renderPrimValue };
export default StackPanel;
