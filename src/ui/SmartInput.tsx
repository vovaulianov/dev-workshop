import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  plain?: boolean;
}

const NUMBER_UNIT_RE = /^(-?\d*\.?\d+)([a-z%]*)\s*$/i;

function parseNumberUnit(v: string): { num: number; unit: string } | null {
  const m = v.trim().match(NUMBER_UNIT_RE);
  if (!m) return null;
  const num = parseFloat(m[1]!);
  if (Number.isNaN(num)) return null;
  return { num, unit: m[2] ?? "" };
}

/**
 * Text input for CSS values. ↑/↓ increments numeric values (Shift = ±10).
 * On Enter/blur, auto-appends unit from the previous value if omitted.
 */
export function SmartInput({ value, onChange, placeholder, className, plain }: Props) {
  const [local, setLocal] = useState(value);
  const lastCommittedRef = useRef(value);
  const composingRef = useRef(false);

  useEffect(() => {
    setLocal(value);
    lastCommittedRef.current = value;
  }, [value]);

  const commit = (raw: string) => {
    if (plain) {
      if (raw !== lastCommittedRef.current) {
        lastCommittedRef.current = raw;
        onChange(raw);
      }
      return;
    }
    let next = raw.trim();
    const parsedNew = parseNumberUnit(next);
    const parsedPrev = parseNumberUnit(lastCommittedRef.current);
    if (parsedNew && !parsedNew.unit && parsedPrev && parsedPrev.unit) {
      next = `${parsedNew.num}${parsedPrev.unit}`;
    }
    setLocal(next);
    if (next !== lastCommittedRef.current) {
      lastCommittedRef.current = next;
      onChange(next);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (plain) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit(local);
      (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const parsed = parseNumberUnit(local);
      if (!parsed) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const sign = e.key === "ArrowUp" ? 1 : -1;
      const nextVal = `${parsed.num + sign * step}${parsed.unit}`;
      setLocal(nextVal);
      lastCommittedRef.current = nextVal;
      onChange(nextVal);
    }
  };

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => !composingRef.current && commit(local)}
      onKeyDown={handleKeyDown}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => { composingRef.current = false; }}
      placeholder={placeholder}
      className={className}
      spellCheck={false}
    />
  );
}
