import { useEffect, useMemo, useState } from "react";
import type { ComponentEntry } from "../lib/storyLoader";
import { groupByCategory } from "../lib/storyLoader";

interface Props {
  entries: ComponentEntry[];
  selectedId: string | null;
  variantIndex: number;
  /** True when the user picked a specific variant; false when the parent
   *  component itself was clicked (so the variant pills shouldn't be
   *  treated as the active selection). */
  variantExplicit: boolean;
  width: number;
  /** `variantIndex = null` means "parent clicked, default variant"; a number
   *  means an explicit variant pick. */
  onSelect: (entry: ComponentEntry, variantIndex: number | null) => void;
}

function HeaderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1.6" y="1.6" width="5.6" height="5.6" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4.8" y="4.8" width="5.6" height="5.6" rx="1.2" fill="white" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function VariantsIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      fill="none"
      aria-hidden="true"
      style={{
        display: "block",
        transition: "transform 120ms ease",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
      }}
    >
      <path d="M3 1.5 L6 4.5 L3 7.5 Z" fill="currentColor" />
    </svg>
  );
}

export function ComponentSidebar({ entries, selectedId, variantIndex, variantExplicit, width, onSelect }: Props) {
  const [query, setQuery] = useState("");
  // Expanded set persists across selection — switching components doesn't
  // collapse previously-expanded ones. Auto-adds the current selection so
  // its variants are visible without a manual toggle.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));

  useEffect(() => {
    if (!selectedId) return;
    setExpanded((prev) => (prev.has(selectedId) ? prev : new Set([...prev, selectedId])));
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

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="dw-card" style={{ width, display: "flex", flexShrink: 0, flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f1f1f1", padding: "12px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Dev Workshop</div>
        <div className="dw-badge" title={`${entries.length} components`}>
          <HeaderIcon />
          <span>{entries.length}</span>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #f1f1f1", padding: "8px 12px" }}>
        <input
          type="search"
          placeholder="Search components…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="dw-search"
        />
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {categoryOrder.length === 0 && (
          <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12, color: "#b3b3b3" }}>Nothing matches</div>
        )}
        {categoryOrder.map((category) => (
          <div key={category} style={{ marginBottom: 12 }}>
            <div className="dw-section-label" style={{ padding: "8px 8px 4px" }}>{category}</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              {groups[category]!.map((entry) => {
                const isSelectedComponent = entry.id === selectedId;
                const hasVariants = entry.variants.length > 1;
                const open = expanded.has(entry.id);
                // Parent row highlighted only when component selected via parent click.
                // If a specific variant is selected, the parent row stays neutral.
                const parentActive = isSelectedComponent && !variantExplicit;
                return (
                  <li key={entry.id}>
                    <div className="dw-sidebar-row" data-active={parentActive ? "true" : "false"}>
                      {hasVariants ? (
                        <button
                          onClick={() => toggleExpanded(entry.id)}
                          className="dw-sidebar-icon-btn"
                          aria-label={open ? "collapse" : "expand"}
                          title={open ? "Collapse variants" : "Expand variants"}
                        >
                          <VariantsIcon expanded={open} />
                        </button>
                      ) : (
                        <span className="dw-sidebar-icon-spacer" />
                      )}
                      <button
                        onClick={() => onSelect(entry, null)}
                        className="dw-sidebar-name-btn"
                      >
                        <span className="dw-sidebar-name">{entry.name}</span>
                        {hasVariants && <span className="dw-sidebar-count">{entry.variants.length}</span>}
                      </button>
                    </div>
                    {open && hasVariants && (
                      <ul style={{ listStyle: "none", margin: "2px 0 4px", padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                        {entry.variants.map((v, i) => {
                          const vActive = isSelectedComponent && variantExplicit && variantIndex === i;
                          return (
                            <li key={v.name}>
                              <div className="dw-sidebar-row dw-sidebar-row-variant" data-active={vActive ? "true" : "false"}>
                                <button
                                  onClick={() => onSelect(entry, i)}
                                  className="dw-sidebar-name-btn"
                                  style={{ flex: 1 }}
                                >
                                  <span className="dw-sidebar-name">{v.name}</span>
                                </button>
                              </div>
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
