import { useEffect, useState } from "react";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  stage: HTMLElement | null;
  hovered: Element | null;
  selected: Element | null;
}

function getRelativeRect(el: Element, stage: HTMLElement): Rect | null {
  const a = el.getBoundingClientRect();
  const b = stage.getBoundingClientRect();
  if (a.width === 0 && a.height === 0) return null;
  return {
    top: a.top - b.top + stage.scrollTop,
    left: a.left - b.left + stage.scrollLeft,
    width: a.width,
    height: a.height,
  };
}

function useRect(el: Element | null, stage: HTMLElement | null, tick: number) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!el || !stage) {
      setRect(null);
      return;
    }
    const update = () => setRect(getRelativeRect(el, stage));
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(stage);

    const mo = new MutationObserver(update);
    mo.observe(stage, { attributes: true, childList: true, subtree: true });

    stage.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      mo.disconnect();
      stage.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [el, stage, tick]);

  return rect;
}

export function SelectionOverlay({ stage, hovered, selected }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => setTick((t) => t + 1), [hovered, selected]);

  const hoverRect = useRect(hovered && hovered !== selected ? hovered : null, stage, tick);
  const selectedRect = useRect(selected, stage, tick);

  return (
    <>
      {hoverRect && (
        <div
          style={{
            position: "absolute",
            pointerEvents: "none",
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
            border: "2px dashed rgba(59, 130, 246, 0.7)",
            zIndex: 999,
          }}
        />
      )}
      {selectedRect && (
        <div
          style={{
            position: "absolute",
            pointerEvents: "none",
            top: selectedRect.top,
            left: selectedRect.left,
            width: selectedRect.width,
            height: selectedRect.height,
            border: "2px solid #3b82f6",
            boxShadow: "0 0 0 1px rgba(59, 130, 246, 0.25)",
            zIndex: 1000,
          }}
        />
      )}
    </>
  );
}
