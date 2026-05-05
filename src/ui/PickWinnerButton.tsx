import { useCallback, useState } from "react";
import type { UseCanvasState } from "../lib/useCanvasState";

interface Props {
  canvas: UseCanvasState;
}

/**
 * Commits the active frame's style overrides to source via /__dev/patch-style,
 * then resets the canvas (single fresh frame, no overrides). Disabled when
 * the active frame has no overrides — in that state there's nothing to commit.
 *
 * Phase 1 lives at the stage corner (one frame visible). In later phases this
 * button will float adjacent to each frame so designer can pick a non-active
 * frame as winner.
 */
export function PickWinnerButton({ canvas }: Props) {
  const { state, activeFrame, pickWinner } = canvas;
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const overrideCount = countOverrides(activeFrame.overrides);

  const onClick = useCallback(async () => {
    if (overrideCount === 0) return;
    setStatus("saving");
    setMessage("");
    const result = await pickWinner(activeFrame.id);
    if (result.failed.length > 0) {
      setStatus("error");
      setMessage(`${result.patched} saved, ${result.failed.length} failed`);
    } else {
      setStatus("saved");
      setMessage(`Wrote ${result.patched} JSX site${result.patched === 1 ? "" : "s"} to source`);
      window.setTimeout(() => {
        setStatus("idle");
        setMessage("");
      }, 2200);
    }
  }, [pickWinner, activeFrame.id, overrideCount]);

  const disabled = overrideCount === 0 || status === "saving";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="dw-btn-primary"
        style={{
          width: "auto",
          padding: "0 14px",
          height: 32,
          fontSize: 12,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          // Subtle shadow so it floats above frames
          boxShadow: "0 4px 12px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.05)",
        }}
        title={
          overrideCount === 0
            ? "Make some changes first"
            : `Apply ${overrideCount} JSX-site override${overrideCount === 1 ? "" : "s"} to source`
        }
      >
        {status === "saving"
          ? "Saving…"
          : status === "saved"
          ? "Saved ✓"
          : `Pick winner${overrideCount ? ` · ${overrideCount}` : ""}`}
      </button>
      {message && (
        <div
          className="dw-mono"
          style={{
            fontSize: 10,
            color: status === "error" ? "var(--dw-error)" : "var(--dw-success)",
            background: "white",
            padding: "3px 8px",
            borderRadius: 4,
            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
          }}
        >
          {message}
        </div>
      )}
      {/* Frames count + active id for context */}
      {state.frames.length > 1 && (
        <div
          className="dw-mono"
          style={{
            fontSize: 10,
            color: "var(--dw-text-muted)",
            background: "rgba(255,255,255,0.85)",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {state.frames.length} frames · active: {activeFrame.label}
        </div>
      )}
    </div>
  );
}

function countOverrides(overrides: Record<string, Record<string, string | null>>): number {
  let count = 0;
  for (const key of Object.keys(overrides)) {
    const styles = overrides[key];
    if (!styles) continue;
    if (Object.keys(styles).length > 0) count += 1;
  }
  return count;
}
