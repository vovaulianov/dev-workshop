import { useCallback, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * Linear undo/redo state with no branching. Each `set` pushes the previous
 * value onto the past stack; `undo`/`redo` move between past/present/future.
 * Calling `reset(value)` clears the stacks (e.g. when selection changes).
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((curr) => {
      const value = typeof next === "function" ? (next as (p: T) => T)(curr.present) : next;
      if (Object.is(value, curr.present)) return curr;
      return { past: [...curr.past, curr.present], present: value, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState((curr) => {
      if (curr.past.length === 0) return curr;
      const prev = curr.past[curr.past.length - 1]!;
      return {
        past: curr.past.slice(0, -1),
        present: prev,
        future: [curr.present, ...curr.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((curr) => {
      if (curr.future.length === 0) return curr;
      const next = curr.future[0]!;
      return {
        past: [...curr.past, curr.present],
        present: next,
        future: curr.future.slice(1),
      };
    });
  }, []);

  const reset = useCallback((value: T) => {
    setState({ past: [], present: value, future: [] });
  }, []);

  return {
    value: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

/**
 * Returns true for Cmd+Z (undo) or Cmd+Shift+Z (redo) on a KeyboardEvent.
 * Does NOT trigger when the event target is an input/textarea/contenteditable —
 * those have their own undo behavior we don't want to override.
 */
export function isUndoRedoKey(e: KeyboardEvent): "undo" | "redo" | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.key !== "z" && e.key !== "Z") return null;
  const t = e.target as HTMLElement | null;
  if (t) {
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (t as HTMLElement).isContentEditable) return null;
  }
  return e.shiftKey ? "redo" : "undo";
}
