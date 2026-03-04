import type { FunctionalComponent } from "preact";
import type { HeapObjectId, HeapObject, PrimValue } from "./types";
import { renderPrimValue } from "./StackPanel";

interface HeapPanelProps {
  heap: Record<HeapObjectId, HeapObject>;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  list: { label: "list", color: "#60a5fa" },
  tuple: { label: "tuple", color: "#a78bfa" },
  set: { label: "set", color: "#fb923c" },
  dict: { label: "dict", color: "#34d399" },
  instance: { label: "instance", color: "var(--color-primary)" },
  function: { label: "fn", color: "#f472b6" },
  other: { label: "obj", color: "var(--color-text-muted)" },
};

function renderSequence(
  obj: { type: string; id: HeapObjectId; elements: PrimValue[] },
  showIndices: boolean
): preact.JSX.Element {
  const info = TYPE_LABELS[obj.type] ?? TYPE_LABELS.other;
  return (
    <div class="heap-object" data-heap-id={obj.id}>
      <div class="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: info.color }}>
        {info.label}
      </div>
      <div class="flex flex-wrap gap-0">
        {obj.elements.length === 0 ? (
          <span class="px-2 py-1 text-[10px] text-[var(--color-text-muted)] italic">
            empty
          </span>
        ) : (
          obj.elements.map((el, i) => (
            <div
              key={i}
              class="flex flex-col items-center border-r border-[var(--color-border)] last:border-r-0"
            >
              {showIndices && (
                <span class="border-b border-[var(--color-border)] px-2 py-0.5 text-[9px] text-[var(--color-text-muted)]">
                  {i}
                </span>
              )}
              <span class="px-2 py-1">{renderPrimValue(el)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function renderDict(
  obj: {
    type: "dict";
    id: HeapObjectId;
    entries: { key: PrimValue; value: PrimValue }[];
  }
): preact.JSX.Element {
  const info = TYPE_LABELS.dict;
  return (
    <div class="heap-object" data-heap-id={obj.id}>
      <div class="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: info.color }}>
        {info.label}
      </div>
      {obj.entries.length === 0 ? (
        <span class="px-2 py-1 text-[10px] text-[var(--color-text-muted)] italic">
          empty
        </span>
      ) : (
        <div class="grid grid-cols-[auto_auto] gap-0">
          {obj.entries.map((entry, i) => (
            <div key={i} class="contents">
              <div class="border-b border-r border-[var(--color-border)] px-2 py-1 last:border-b-0">
                {renderPrimValue(entry.key)}
              </div>
              <div class="border-b border-[var(--color-border)] px-2 py-1 last:border-b-0">
                {renderPrimValue(entry.value)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderInstance(
  obj: {
    type: "instance";
    id: HeapObjectId;
    className: string;
    attrs: { name: string; value: PrimValue }[];
  }
): preact.JSX.Element {
  return (
    <div class="heap-object" data-heap-id={obj.id}>
      <div
        class="mb-1 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "var(--color-primary)" }}
      >
        {obj.className}
      </div>
      {obj.attrs.length === 0 ? (
        <span class="px-2 py-1 text-[10px] text-[var(--color-text-muted)] italic">
          no attributes
        </span>
      ) : (
        obj.attrs.map((attr) => (
          <div
            key={attr.name}
            class="flex items-center justify-between gap-3 px-2 py-0.5"
          >
            <span class="text-xs font-medium text-[var(--color-heading)]">
              {attr.name}
            </span>
            <span>{renderPrimValue(attr.value)}</span>
          </div>
        ))
      )}
    </div>
  );
}

function renderFunction(
  obj: { type: "function"; id: HeapObjectId; name: string; params: string[] }
): preact.JSX.Element {
  return (
    <div class="heap-object" data-heap-id={obj.id}>
      <span
        class="rounded px-2 py-0.5 text-[10px] font-bold"
        style={{
          color: "#f472b6",
          backgroundColor: "color-mix(in srgb, #f472b6 12%, transparent)",
        }}
      >
        fn {obj.name}({obj.params.join(", ")})
      </span>
    </div>
  );
}

function renderOther(
  obj: { type: "other"; id: HeapObjectId; repr: string }
): preact.JSX.Element {
  return (
    <div class="heap-object" data-heap-id={obj.id}>
      <span class="rounded px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
        {obj.repr}
      </span>
    </div>
  );
}

function renderHeapObject(obj: HeapObject): preact.JSX.Element {
  switch (obj.type) {
    case "list":
      return renderSequence(obj, true);
    case "tuple":
      return renderSequence(obj, true);
    case "set":
      return renderSequence(obj, false);
    case "dict":
      return renderDict(obj);
    case "instance":
      return renderInstance(obj);
    case "function":
      return renderFunction(obj);
    case "other":
      return renderOther(obj);
  }
}

const HeapPanel: FunctionalComponent<HeapPanelProps> = ({ heap }) => {
  const entries = Object.entries(heap);

  if (entries.length === 0) {
    return (
      <div class="p-4">
        <h3 class="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Objects
        </h3>
        <p class="text-xs text-[var(--color-text-muted)]/50 italic">
          No heap objects
        </p>
      </div>
    );
  }

  return (
    <div class="heap-panel flex flex-col gap-3 p-3">
      <h3 class="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        Objects
      </h3>
      {entries.map(([id, obj]) => (
        <div
          key={id}
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/50 p-2"
        >
          {renderHeapObject(obj)}
        </div>
      ))}
    </div>
  );
};

export default HeapPanel;
