import { useState, useEffect, useMemo, useRef, useCallback } from "preact/hooks";
import Fuse from "fuse.js";

interface SearchEntry {
  title: string;
  description: string;
  url: string;
  section: string;
  tags?: string[];
}

interface Props {
  entries: SearchEntry[];
}

export default function CommandPalette({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(entries, {
        keys: [
          { name: "title", weight: 0.45 },
          { name: "description", weight: 0.3 },
          { name: "tags", weight: 0.15 },
          { name: "section", weight: 0.1 },
        ],
        threshold: 0.35,
        includeScore: true,
      }),
    [entries]
  );

  const results = useMemo(() => {
    if (!query.trim()) return entries.slice(0, 8);
    return fuse.search(query, { limit: 12 }).map((r) => r.item);
  }, [query, fuse, entries]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // Cmd+K / Ctrl+K to toggle
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const navigate = useCallback(
    (url: string) => {
      setOpen(false);
      window.location.href = url;
    },
    []
  );

  const onInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[activeIndex]) {
        e.preventDefault();
        navigate(results[activeIndex].url);
      }
    },
    [results, activeIndex, navigate]
  );

  if (!open) return null;

  const sectionIcons: Record<string, string> = {
    Page: "◇",
    Blog: "✎",
    Lab: "⚗",
    CV: "◈",
  };

  return (
    <div
      class="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      {/* Backdrop */}
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div class="cmd-palette relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
        {/* Input */}
        <div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <svg
            class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, blog posts, tools..."
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={onInputKeyDown}
            class="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]/50"
          />
          <kbd class="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} class="max-h-[320px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div class="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
              No results found
            </div>
          ) : (
            results.map((item, i) => (
              <button
                key={item.url}
                data-active={i === activeIndex}
                onClick={() => navigate(item.url)}
                onMouseEnter={() => setActiveIndex(i)}
                class={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activeIndex
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-heading)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/20"
                }`}
              >
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-xs">
                  {sectionIcons[item.section] || "·"}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{item.title}</div>
                  <div class="truncate text-xs text-[var(--color-text-muted)]">
                    {item.description}
                  </div>
                </div>
                <span class="shrink-0 text-[10px] text-[var(--color-text-muted)]/50">
                  {item.section}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div class="flex items-center gap-4 border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-text-muted)]/40">
          <span>
            <kbd class="rounded border border-[var(--color-border)] px-1 py-0.5">↑↓</kbd> navigate
          </span>
          <span>
            <kbd class="rounded border border-[var(--color-border)] px-1 py-0.5">↵</kbd> open
          </span>
          <span>
            <kbd class="rounded border border-[var(--color-border)] px-1 py-0.5">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
