import type { ComponentType, ReactNode } from "react";

type AnyArgs = Record<string, unknown>;
type StoryRender = (args: AnyArgs, context?: unknown) => ReactNode;
type StoryDecorator = (Story: ComponentType, context?: unknown) => ReactNode;

interface StorybookMeta {
  title: string;
  component: ComponentType<AnyArgs>;
  args?: AnyArgs;
  parameters?: Record<string, unknown>;
  decorators?: StoryDecorator[];
}

interface StoryObject {
  args?: AnyArgs;
  render?: StoryRender;
  decorators?: StoryDecorator[];
  parameters?: Record<string, unknown>;
}

export interface StoryVariant {
  name: string;
  args: AnyArgs;
  render?: StoryRender;
  decorators?: StoryDecorator[];
}

export interface ComponentEntry {
  id: string;
  name: string;
  category: string;
  component: ComponentType<AnyArgs>;
  storyFile: string;
  sourceFile: string;
  metaDecorators?: StoryDecorator[];
  variants: StoryVariant[];
}

type StoryModule = {
  default?: StorybookMeta;
  [key: string]: StorybookMeta | StoryObject | undefined;
};

function pathToStoryFile(globKey: string): string {
  // globKey can be "/src/components/ui/Button.stories.tsx" or relative
  // Normalise to "src/..." so the Code tab shows a clean path.
  return globKey.replace(/^(\.\.\/)*/, "").replace(/^\//, "");
}

function storyFileToSource(storyFile: string): string {
  return storyFile.replace(/\.stories\.tsx$/, ".tsx");
}

function prettifyName(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function buildEntry(
  globKey: string,
  mod: StoryModule,
): ComponentEntry | null {
  const meta = mod.default;
  if (!meta || !meta.component || !meta.title) return null;

  const storyFile = pathToStoryFile(globKey);
  const sourceFile = storyFileToSource(storyFile);
  const titleParts = meta.title.split("/");
  const category = titleParts.length > 1 ? titleParts[0]! : "Other";
  const name = titleParts.length > 1 ? titleParts.slice(1).join("/") : titleParts[0]!;

  const variants: StoryVariant[] = Object.entries(mod)
    .filter(([key, value]) => key !== "default" && value && typeof value === "object")
    .map(([key, value]) => {
      const story = value as StoryObject;
      return {
        name: prettifyName(key),
        args: { ...(meta.args ?? {}), ...(story.args ?? {}) },
        render: story.render,
        decorators: story.decorators,
      };
    });

  if (variants.length === 0) {
    variants.push({ name: "Default", args: meta.args ?? {} });
  }

  const id = `${category}/${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return {
    id,
    name,
    category,
    component: meta.component,
    storyFile,
    sourceFile,
    metaDecorators: meta.decorators,
    variants,
  };
}

/** Build component entries from raw story modules (from import.meta.glob). */
export function buildComponentEntries(
  modules: Record<string, unknown>,
): ComponentEntry[] {
  return Object.entries(modules)
    .map(([key, mod]) => buildEntry(key, mod as StoryModule))
    .filter((e): e is ComponentEntry => e !== null)
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });
}

export function groupByCategory(
  entries: ComponentEntry[],
): Record<string, ComponentEntry[]> {
  const groups: Record<string, ComponentEntry[]> = {};
  for (const entry of entries) {
    (groups[entry.category] ||= []).push(entry);
  }
  return groups;
}
