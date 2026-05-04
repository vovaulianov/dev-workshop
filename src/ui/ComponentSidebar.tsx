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
    <aside style={{ width, display: "flex", flexShrink: 0, flexDirection: "column", height: "100%", background: "white", color: "#101114" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5e5e5", padding: "12px 16px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Dev Workshop</div>
        <div className="dw-mono" style={{ fontSize: 11, color: "#b3b3b3" }}>{entries.length}</div>
      </div>

      <div style={{ borderBottom: "1px solid #e5e5e5", padding: "8px 12px" }}>
        <input
          type="search"
          placeholder="Search components…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="dw-search"
        />
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {categoryOrder.length === 0 && (
          <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: "#b3b3b3" }}>Nothing matches</div>
        )}
        {categoryOrder.map((category) => (
          <div key={category} style={{ marginBottom: 12 }}>
            <div className="dw-section-label" style={{ padding: "8px 16px 4px" }}>{category}</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {groups[category]!.map((entry) => {
                const active = entry.id === selectedId;
                const open = expanded.has(entry.id);
                const hasVariants = entry.variants.length > 1;
                return (
                  <li key={entry.id}>
                    <div style={{ display: "flex", alignItems: "stretch" }}>
                      {hasVariants ? (
                        <button
                          onClick={() => toggle(entry.id)}
                          aria-label={open ? "collapse" : "expand"}
                          style={{ display: "flex", width: 20, flexShrink: 0, alignItems: "center", justifyContent: "center", fontSize: 10, color: "#b3b3b3" }}
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      ) : (
                        <span style={{ width: 20, flexShrink: 0 }} />
                      )}
                      <button
                        onClick={() => onSelect(entry, 0)}
                        className="dw-sidebar-item"
                        data-active={active ? "true" : "false"}
                      >
                        {entry.name}
                        {hasVariants && <span style={{ marginLeft: 8, fontSize: 10, color: "#b3b3b3" }}>{entry.variants.length}</span>}
                      </button>
                    </div>
                    {open && hasVariants && (
                      <ul style={{ listStyle: "none", margin: "0 0 4px", padding: 0 }}>
                        {entry.variants.map((v, i) => {
                          const vActive = active && variantIndex === i;
                          return (
                            <li key={v.name}>
                              <button
                                onClick={() => onSelect(entry, i)}
                                className="dw-sidebar-item dw-sidebar-item-variant"
                                data-active={vActive ? "true" : "false"}
                                style={{ width: "100%" }}
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
