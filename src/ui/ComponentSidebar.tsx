import { useEffect, useMemo, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import { groupByCategory } from "../lib/storyLoader";

interface Props {
  entries: ComponentEntry[];
  selectedId: string | null;
  variantIndex: number;
  width: number;
  onSelect: (entry: ComponentEntry, variantIndex?: number) => void;
}

export function ComponentSidebar({ entries, selectedId, variantIndex, width, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));

  useEffect(() => {
    if (!selectedId) return;
    setExpanded((prev) => {
      if (prev.has(selectedId)) return prev;
      const next = new Set(prev);
      next.add(selectedId);
      return next;
    });
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || e.variants.some((v) => v.name.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const categoryOrder = Object.keys(groups).sort();

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside style={{ width }} className="flex h-full shrink-0 flex-col bg-white text-[#101114]">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
        <div className="text-[15px] font-semibold">Dev Workshop</div>
        <div className="font-mono text-[11px] text-[#b3b3b3]">{entries.length}</div>
      </div>

      <div className="border-b border-[#e5e5e5] px-3 py-2">
        <input
          type="search"
          placeholder="Search components…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md bg-[#f4f4f4] px-3 py-2 text-[13px] text-[#101114] placeholder:text-[#b3b3b3] outline-none focus:bg-[#ebebeb]"
        />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {categoryOrder.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px] text-[#b3b3b3]">Nothing matches</div>
        )}
        {categoryOrder.map((category) => (
          <div key={category} className="mb-3">
            <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#b3b3b3]">{category}</div>
            <ul>
              {groups[category]!.map((entry) => {
                const active = entry.id === selectedId;
                const open = expanded.has(entry.id);
                const hasVariants = entry.variants.length > 1;
                return (
                  <li key={entry.id}>
                    <div className="flex items-stretch">
                      {hasVariants ? (
                        <button onClick={() => toggle(entry.id)} aria-label={open ? "collapse" : "expand"} className="flex w-5 shrink-0 items-center justify-center text-[10px] text-[#b3b3b3] hover:text-[#101114]">
                          {open ? "▾" : "▸"}
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      <button
                        onClick={() => onSelect(entry, 0)}
                        className={["block flex-1 py-1.5 pr-4 text-left text-[13px] transition-colors", active ? "bg-[#f4f4f4] text-[#101114] font-medium" : "text-[#606060] hover:bg-[#fafafa] hover:text-[#101114]"].join(" ")}
                      >
                        {entry.name}
                        {hasVariants && <span className="ml-2 text-[10px] text-[#b3b3b3]">{entry.variants.length}</span>}
                      </button>
                    </div>
                    {open && hasVariants && (
                      <ul className="mb-1">
                        {entry.variants.map((v, i) => {
                          const vActive = active && variantIndex === i;
                          return (
                            <li key={v.name}>
                              <button
                                onClick={() => onSelect(entry, i)}
                                className={["block w-full py-1 pl-10 pr-4 text-left text-[12px] transition-colors", vActive ? "bg-[#f4f4f4] text-[#101114] font-medium" : "text-[#808080] hover:bg-[#fafafa] hover:text-[#101114]"].join(" ")}
                              >
                                {v.name}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
