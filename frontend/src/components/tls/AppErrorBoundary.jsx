import { Component } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { reportCaughtError } from "@/lib/clientLog";

// Fehlergrenze (#944): stürzt eine Seite beim Zeichnen ab, bleibt die Website bedienbar - Kopfzeile und Footer
// stehen, dazwischen ein Hinweis mit „Neu laden“. Stürzt auch der Rahmen ab, oder im Adminbereich und auf den
// Anzeige-Seiten, bleibt die schlichte Karte über die ganze Fläche. Die technische Meldung sieht nur, wer entwickelt.

const PLAIN_ROUTES = /^\/(admin|display)(\/|$)/;

class Boundary extends Component {
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
    reportCaughtError(error, errorInfo?.componentStack);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

function ErrorCard({ error }) {
  return (
    <div className="max-w-xl w-full mx-auto border border-[#FF3B30]/30 bg-[#121212] rounded-sm p-6 text-center" role="alert" data-testid="page-error">
      <div className="mx-auto mb-5 w-14 h-14 rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 flex items-center justify-center text-[#FF3B30]">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <h1 className="font-heading text-2xl md:text-3xl font-black uppercase">Diese Seite konnte nicht angezeigt werden</h1>
      <p className="mt-3 text-sm text-white/60">
        Lade die Seite neu. Hilft das nicht, probier es später noch einmal – der Rest der Website funktioniert weiter.
      </p>
      {import.meta.env.DEV && error?.message ? (
        <div className="mt-4 border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2 text-left text-xs text-white/45 font-mono break-words">
          {error.message}
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 font-bold uppercase tracking-wider rounded-sm text-xs"
        >
          <RefreshCw className="w-4 h-4" /> Neu laden
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-xs hover:border-[#29B6E8] hover:text-[#29B6E8]"
        >
          <Home className="w-4 h-4" /> Startseite
        </Link>
      </div>
    </div>
  );
}

function PlainScreen({ error }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center px-4 py-10">
      <ErrorCard error={error} />
    </div>
  );
}

export function AppErrorBoundary({ children }) {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}`;
  const plain = PLAIN_ROUTES.test(location.pathname);
  const fallback = (error) => (plain ? <PlainScreen error={error} /> : (
    <Boundary resetKey={resetKey} fallback={() => <PlainScreen error={error} />}>
      <PublicLayout>
        <section className="px-4 py-16">
          <ErrorCard error={error} />
        </section>
      </PublicLayout>
    </Boundary>
  ));
  return <Boundary resetKey={resetKey} fallback={fallback}>{children}</Boundary>;
}
