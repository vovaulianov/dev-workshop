import { useCallback, useRef, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * Linear undo/redo state with no branching. Each `set` pushes the previous
 * value onto the past stack; `undo`/`redo` move between past/present/future.
 * Calling `reset(value)` clears the stacks (e.g. when selection changes).
 *
 * Transactions: continuous gestures (drag-to-move, resize-handle drag) call
 * `beginTransaction()` on pointerdown and `commitTransaction()` on pointerup.
 * Inside a transaction, `set()` updates `present` but does not push every
 * intermediate value onto `past` — instead, the snapshot taken at
 * `beginTransaction()` is pushed once at commit, so the entire gesture
 * reads as a single undo step. Without this, hundreds of pointermove ticks
 * would balloon the history stack and freeze the page within seconds.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });

  // Holds the "before" snapshot during an active transaction. null = no
  // transaction; set() will push to past as usual. Non-null = inside
  // transaction; set() updates present in place without pushing to past.
  const transactionSnapshotRef = useRef<T | null>(null);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((curr) => {
      const value = typeof next === "function" ? (next as (p: T) => T)(curr.present) : next;
      if (Object.is(value, curr.present)) return curr;
      if (transactionSnapshotRef.current !== null) {
        // Inside a transaction — coalesce: update present, leave past alone,
        // discard any future (this is still a forward edit even if mid-gesture).
        return { ...curr, present: value, future: [] };
      }
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
    transactionSnapshotRef.current = null;
    setState({ past: [], present: value, future: [] });
  }, []);

  /** Mark the start of a continuous gesture. Subsequent `set` calls update
   *  the present in place without pushing to past. Idempotent — calling
   *  twice without an intervening commit just keeps the original snapshot. */
  const beginTransaction = useCallback(() => {
    if (transactionSnapshotRef.current !== null) return;
    setState((curr) => {
      transactionSnapshotRef.current = curr.present;
      return curr;
    });
  }, []);

  /** Finalize the gesture: push the pre-gesture snapshot onto past so
   *  Cmd+Z reverts the entire gesture. No-op if the present matches the
   *  snapshot (gesture made no net change). */
  const commitTransaction = useCallback(() => {
    const snap = transactionSnapshotRef.current;
    transactionSnapshotRef.current = null;
    if (snap === null) return;
    setState((curr) => {
      if (Object.is(curr.present, snap)) return curr;
      return { ...curr, past: [...curr.past, snap], future: [] };
    });
  }, []);

  return {
    value: state.present,
    set,
    undo,
    redo,
    reset,
    beginTransaction,
    commitTransaction,
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
