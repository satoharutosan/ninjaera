import { Component, type ErrorInfo, type ReactNode } from "react";
import { BrandLogo } from "@/shared/BrandLogo";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Desktop-only Error Boundary. Catches unexpected renderer exceptions so the
 * window does not go blank; logs the full stack for developers. Does not
 * suppress errors — they remain visible in DevTools.
 */
export class DesktopErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Preserve stack traces for developers — never swallow programming errors.
    console.error("[DesktopErrorBoundary] Uncaught renderer error:", error);
    console.error("[DesktopErrorBoundary] Component stack:", info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
          boxSizing: "border-box",
          background: "#141218",
          color: "#E6E1E5",
          fontFamily: "Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <BrandLogo size={48} priority />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, fontFamily: "'Trade Winds', cursive" }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, color: "#CAC4D0", lineHeight: 1.5 }}>
          The desktop app hit an unexpected error. You can reload to continue — if the problem
          persists, check the developer console for details.
        </p>
        {import.meta.env.DEV && (
          <pre
            style={{
              margin: 0,
              maxWidth: "min(560px, 100%)",
              maxHeight: 160,
              overflow: "auto",
              padding: "12px 14px",
              borderRadius: 12,
              background: "#1D1B20",
              color: "#F2B8B5",
              fontSize: 12,
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 8,
            padding: "10px 22px",
            borderRadius: 999,
            border: "none",
            background: "#6750A4",
            color: "#fff",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "Roboto, sans-serif",
          }}
        >
          Reload app
        </button>
      </div>
    );
  }
}
