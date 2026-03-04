import { useState, useEffect } from "preact/hooks";
import { toolRegistry } from "./tool-registry";
import type { ComponentType } from "preact";

interface Props {
  slug: string;
}

export default function ToolLoader({ slug }: Props) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loader = toolRegistry[slug];
    if (!loader) {
      setError(`Tool "${slug}" not found in registry.`);
      return;
    }

    loader()
      .then((mod) => setComponent(() => mod.default))
      .catch((err) => setError(`Failed to load tool: ${err}`));
  }, [slug]);

  if (error) {
    return (
      <div class="rounded-2xl border border-red-500/30 bg-[var(--color-surface)] p-8 text-center">
        <p class="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!Component) {
    return (
      <div class="flex items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-12">
        <div class="text-center">
          <div class="mx-auto mb-4 h-8 w-8 animate-pulse rounded-full bg-[var(--color-primary)]"></div>
          <p class="text-sm text-[var(--color-text-muted)]">Loading tool...</p>
        </div>
      </div>
    );
  }

  return <Component />;
}
