import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Catches errors from the user's component so a single broken story
 * (e.g. a stub with empty args missing a required prop) doesn't tear
 * down the whole workshop. Reset by changing `resetKey`.
 */
export class CanvasErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(_e: Error, _info: ErrorInfo) {
    /* swallow — message shown in fallback */
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "var(--dw-font-mono)",
            fontSize: 12,
            color: "#dc2626",
            background: "#fff4f4",
            borderRadius: 8,
            maxWidth: 480,
            margin: "24px auto",
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontFamily: "var(--dw-font)", fontWeight: 600, marginBottom: 8 }}>
            Render error
          </div>
          {this.state.error.message}
          <div
            style={{
              marginTop: 12,
              fontFamily: "var(--dw-font)",
              fontSize: 11,
              color: "#808080",
            }}
          >
            Stub stories use empty args; this component likely needs required props.
            Edit the stories file to add them.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
