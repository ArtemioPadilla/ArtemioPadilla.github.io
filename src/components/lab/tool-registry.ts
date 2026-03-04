import type { ComponentType } from "preact";

type ToolImport = () => Promise<{ default: ComponentType }>;

export const toolRegistry: Record<string, ToolImport> = {
  // Register new tools here:
  // "tool-slug": () => import("./ToolComponent.tsx"),
};
