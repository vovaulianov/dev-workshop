/**
 * Per-component canvas state for Element/Inspect mode.
 *
 * Phase 1 of the Figma-like canvas. Holds N frames (Phase 1: always 1; Phase 2
 * adds Cmd+D), pan/zoom, current selection, per-frame style overrides keyed
 * by JSX source location (`file:line:col`).
 *
 * Style mutations from the inspector flow through `applyOverride` instead of
 * `patchStyle`. Source is only touched when the user explicitly clicks
 * "Pick winner" on a frame — that batches all of that frame's overrides
 * through `/__dev/patch-style`.
 *
 * State persists to `localStorage[dw:canvas:<componentId>]` (debounced 300ms)
 * so designers can refresh and resume.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useHistory } from "./useHistory";
import type { ElementSource } from "./fiberUtils";
import { patchStyle } from "./devApi";

export type SourceLoc = string; // "src/foo/Bar.tsx:32:4"
export type FrameId = string;

/** Map from CSS property (kebab-case, e.g. "padding-top") to value or null
 *  (null = remove). We store kebab-case so we can pass directly to
 *  `el.style.setProperty(prop, value)`. */
export type StyleOverride = Record<string, string | null>;

export interface Frame {
  id: FrameId;
  /** Canvas-space coordinates (top-left of frame in stage). */
  x: number;
  y: number;
  label: string;
  variantIndex: number;
  /** key = `file:line:col`, value = map of CSS prop → value */
  overrides: Record<SourceLoc, StyleOverride>;
}

export interface CanvasState {
  frames: Frame[];
  activeFrameId: FrameId;
  selection: { frameId: FrameId; sourceLoc: SourceLoc | null };
  pan: { x: number; y: number };
  zoom: number;
  /** Schema version — bump on breaking shape changes so old LS entries
   *  get discarded instead of crashing. */
  v: number;
}

const STATE_VERSION = 1;
const LS_PREFIX = "dw:canvas:";

function makeId(): FrameId {
  return Math.random().toString(36).slice(2, 10);
}

export function sourceToLoc(src: ElementSource): SourceLoc {
  return `${src.file}:${src.line}:${src.column}`;
}

export function locToSource(loc: SourceLoc): ElementSource | null {
  const parts = loc.split(":");
  if (parts.length < 3) return null;
  const column = Number(parts.pop());
  const line = Number(parts.pop());
  const file = parts.join(":");
  if (!file || Number.isNaN(line) || Number.isNaN(column)) return null;
  return { file, line, column };
}

function defaultState(variantIndex: number): CanvasState {
  const id = makeId();
  return {
    frames: [{ id, x: 0, y: 0, label: "Frame 1", variantIndex, overrides: {} }],
    activeFrameId: id,
    selection: { frameId: id, sourceLoc: null },
    pan: { x: 0, y: 0 },
    zoom: 1,
    v: STATE_VERSION,
  };
}

function loadFromLs(componentId: string): CanvasState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + componentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== STATE_VERSION) return null;
    if (!Array.isArray(parsed.frames) || parsed.frames.length === 0) return null;
    return parsed as CanvasState;
  } catch {
    return null;
  }
}

function saveToLs(componentId: string, state: CanvasState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PREFIX + componentId, JSON.stringify(state));
  } catch {
    /* quota exhaustion or disabled storage — silent */
  }
}

function clearLs(componentId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LS_PREFIX + componentId);
  } catch {
    /* ignore */
  }
}

export interface UseCanvasState {
  state: CanvasState;
  /** Active frame helper (always defined — schema guarantees ≥ 1 frame). */
  activeFrame: Frame;

  /** Per-frame style override write. `cssProp` is kebab-case. `null` removes. */
  applyOverride: (frameId: FrameId, srcLoc: SourceLoc, cssProp: string, value: string | null) => void;

  /** Bulk replace overrides for a single (frame, srcLoc). Used to discard. */
  setOverridesForLoc: (frameId: FrameId, srcLoc: SourceLoc, next: StyleOverride) => void;

  /** Drop all overrides on this loc within the active frame (Discard for current selection). */
  clearOverridesForLoc: (frameId: FrameId, srcLoc: SourceLoc) => void;

  /** Update selection — single sourceLoc per frame in Phase 1. */
  setSelection: (sel: { frameId: FrameId; sourceLoc: SourceLoc | null }) => void;

  /** Pan/zoom mutators. */
  setPan: (next: { x: number; y: number }) => void;
  setZoom: (next: number) => void;

  /** Pick winner: batch-apply this frame's overrides via patch-style, then
   *  reset state (single frame remains, no overrides, fresh selection). */
  pickWinner: (frameId: FrameId) => Promise<{ patched: number; failed: Array<{ loc: SourceLoc; error: string }> }>;

  /** Discard ALL canvas state for this component (back to one default frame). */
  resetAll: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCanvasState(componentId: string, defaultVariantIndex: number): UseCanvasState {
  const initial = useMemo(
    () => loadFromLs(componentId) ?? defaultState(defaultVariantIndex),
    // Only re-init when componentId changes; the default variant is just
    // for first-mount state, ignore it on later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentId],
  );

  const h = useHistory<CanvasState>(initial);

  // Reset state when componentId actually changes (DevWorkshopPage doesn't
  // remount this hook — same instance lives across selection switches).
  const lastComponentIdRef = useRef(componentId);
  useEffect(() => {
    if (lastComponentIdRef.current !== componentId) {
      lastComponentIdRef.current = componentId;
      h.reset(loadFromLs(componentId) ?? defaultState(defaultVariantIndex));
    }
  }, [componentId, defaultVariantIndex, h]);

  // Debounced persistence to localStorage.
  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      saveToLs(componentId, h.value);
      persistTimer.current = null;
    }, 300);
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [h.value, componentId]);

  const activeFrame = useMemo(() => {
    return h.value.frames.find((f) => f.id === h.value.activeFrameId) ?? h.value.frames[0]!;
  }, [h.value]);

  const applyOverride = useCallback<UseCanvasState["applyOverride"]>(
    (frameId, srcLoc, cssProp, value) => {
      h.set((curr) => ({
        ...curr,
        frames: curr.frames.map((f) => {
          if (f.id !== frameId) return f;
          const existing = f.overrides[srcLoc] ?? {};
          const nextLocOverrides: StyleOverride = { ...existing };
          if (value === null || value === "") {
            delete nextLocOverrides[cssProp];
          } else {
            nextLocOverrides[cssProp] = value;
          }
          const overrides = { ...f.overrides };
          if (Object.keys(nextLocOverrides).length === 0) delete overrides[srcLoc];
          else overrides[srcLoc] = nextLocOverrides;
          return { ...f, overrides };
        }),
      }));
    },
    [h],
  );

  const setOverridesForLoc = useCallback<UseCanvasState["setOverridesForLoc"]>(
    (frameId, srcLoc, next) => {
      h.set((curr) => ({
        ...curr,
        frames: curr.frames.map((f) => {
          if (f.id !== frameId) return f;
          const overrides = { ...f.overrides };
          if (Object.keys(next).length === 0) delete overrides[srcLoc];
          else overrides[srcLoc] = next;
          return { ...f, overrides };
        }),
      }));
    },
    [h],
  );

  const clearOverridesForLoc = useCallback<UseCanvasState["clearOverridesForLoc"]>(
    (frameId, srcLoc) => setOverridesForLoc(frameId, srcLoc, {}),
    [setOverridesForLoc],
  );

  const setSelection = useCallback<UseCanvasState["setSelection"]>(
    (sel) => h.set((curr) => ({ ...curr, selection: sel, activeFrameId: sel.frameId })),
    [h],
  );

  const setPan = useCallback<UseCanvasState["setPan"]>(
    (next) => h.set((curr) => ({ ...curr, pan: next })),
    [h],
  );

  const setZoom = useCallback<UseCanvasState["setZoom"]>(
    (next) => h.set((curr) => ({ ...curr, zoom: Math.max(0.25, Math.min(4, next)) })),
    [h],
  );

  const pickWinner = useCallback<UseCanvasState["pickWinner"]>(
    async (frameId) => {
      const frame = h.value.frames.find((f) => f.id === frameId);
      if (!frame) return { patched: 0, failed: [] };
      let patched = 0;
      const failed: Array<{ loc: SourceLoc; error: string }> = [];
      for (const [loc, styles] of Object.entries(frame.overrides)) {
        const src = locToSource(loc);
        if (!src) {
          failed.push({ loc, error: "invalid source location" });
          continue;
        }
        try {
          // patchStyle expects camelCase-ish keys (it normalizes both ways).
          // Our overrides are kebab-case, which patchStyle handles.
          await patchStyle({
            file: src.file,
            line: src.line,
            column: src.column,
            styleUpdates: styles,
          });
          patched += 1;
        } catch (err) {
          failed.push({ loc, error: err instanceof Error ? err.message : String(err) });
        }
      }
      // After successful commit, blow away canvas state for this component:
      // the source file now reflects the winner, so we don't want stale
      // overrides applied on top of fresh source.
      clearLs(componentId);
      h.reset(defaultState(frame.variantIndex));
      return { patched, failed };
    },
    [h, componentId],
  );

  const resetAll = useCallback<UseCanvasState["resetAll"]>(() => {
    clearLs(componentId);
    h.reset(defaultState(defaultVariantIndex));
  }, [h, componentId, defaultVariantIndex]);

  return {
    state: h.value,
    activeFrame,
    applyOverride,
    setOverridesForLoc,
    clearOverridesForLoc,
    setSelection,
    setPan,
    setZoom,
    pickWinner,
    resetAll,
    undo: h.undo,
    redo: h.redo,
    canUndo: h.canUndo,
    canRedo: h.canRedo,
  };
}
