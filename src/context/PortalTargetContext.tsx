/**
 * Optional override for the portal target used by modal-style components
 * (BottomSheet, etc.). In production this is always `document.body`. The Dev
 * Workshop uses it to keep sheets visually constrained inside the preview
 * canvas so the whole screen isn't covered during inspection.
 *
 * Export this from your project's context layer and import `usePortalTarget`
 * in any component that uses a portal (e.g. BottomSheet).
 */
import { createContext, useContext, type ReactNode } from "react";

const PortalTargetContext = createContext<HTMLElement | null>(null);

export function PortalTargetProvider({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PortalTargetContext.Provider value={target}>
      {children}
    </PortalTargetContext.Provider>
  );
}

/**
 * Returns the portal target — the provided override if one is set by an
 * ancestor `<PortalTargetProvider>`, otherwise `document.body`.
 * Safe to call in SSR-like no-DOM scenarios (returns `null` then).
 */
export function usePortalTarget(): HTMLElement | null {
  const override = useContext(PortalTargetContext);
  if (override) return override;
  return typeof document !== "undefined" ? document.body : null;
}
