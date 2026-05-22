import { Component } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

class AppErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, errorInfo) {
    console.error("[TLS] Frontend-Fehler:", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error?.message || "Unbekannter Frontend-Fehler";

    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center px-4 py-10">
        <div className="max-w-xl w-full border border-[#FF3B30]/30 bg-[#121212] rounded-sm p-6 text-center">
          <div className="mx-auto mb-5 w-14 h-14 rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 flex items-center justify-center text-[#FF3B30]">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">Frontend-Fehler</div>
          <h1 className="mt-2 font-heading text-2xl md:text-3xl font-black uppercase">Diese Ansicht konnte nicht geladen werden</h1>
          <p className="mt-3 text-sm text-white/60">
            Die Seite ist nicht komplett abgestürzt. Du kannst neu laden oder zur Startseite wechseln.
          </p>
          <div className="mt-4 border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2 text-left text-xs text-white/45 font-mono break-words">
            {message}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs"
            >
              <RefreshCw className="w-4 h-4" /> Neu laden
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-xs hover:border-[#29B6E8]/50"
            >
              <Home className="w-4 h-4" /> Startseite
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export function AppErrorBoundary({ children }) {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}`;
  return <AppErrorBoundaryInner resetKey={resetKey}>{children}</AppErrorBoundaryInner>;
}
