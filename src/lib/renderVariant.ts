/**
 * Render a story variant — runs decorators (meta-level then variant-level) and
 * returns the final ReactNode. Shared between the legacy single-frame
 * ComponentPreview stage and the new multi-frame CanvasStage.
 */
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ComponentEntry, StoryVariant } from "./storyLoader";

type AnyArgs = Record<string, unknown>;
type Decorator = (Story: ComponentType, context?: unknown) => ReactNode;

export function renderVariant(
  entry: ComponentEntry,
  variant: StoryVariant,
  argsOverride: AnyArgs,
): ReactNode {
  const mergedArgs: AnyArgs = { ...(variant.args as AnyArgs), ...argsOverride };
  const baseRender = variant.render
    ? () => variant.render!(mergedArgs, { args: mergedArgs })
    : () => createElement(entry.component, mergedArgs);

  const decorators: Decorator[] = [
    ...(entry.metaDecorators ?? []),
    ...(variant.decorators ?? []),
  ];
  if (decorators.length === 0) return baseRender();

  let storyFn: () => ReactNode = baseRender;
  for (const decorator of [...decorators].reverse()) {
    const prev = storyFn;
    const StoryComponent: ComponentType = () => prev() as ReactNode;
    storyFn = () => decorator(StoryComponent, { args: variant.args });
  }
  return storyFn();
}
