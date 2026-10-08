import { Component, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ClipboardCopy, Home, RefreshCw } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useOptionalAuth } from "@/context/AuthContext";
import { reportCaughtError, scrubClientLogText } from "@/lib/clientLog";
import { viennaDateTime } from "@/lib/vienna";

// Fehlergrenze (#944): stürzt eine Seite beim Zeichnen ab, bleibt die Website bedienbar - Kopfzeile und Footer
// stehen, dazwischen ein Hinweis mit „Neu laden“. Stürzt auch der Rahmen ab, oder im Adminbereich und auf den
// Anzeige-Seiten, bleibt die schlichte Karte über die ganze Fläche.
// Technische Angaben (#1230): nur Konten mit Admin-Bereich sehen sie, zugeklappt und zum Kopieren - Fehlertext,
// Seite, Uhrzeit und die Kennung der Meldung, die unter „Betrieb & Logs“ wieder auftaucht. Alle anderen sehen nur
// den freundlichen Satz, auch beim Entwickeln - so prüft der Browser-Test genau das, was im Betrieb gilt.

const PLAIN_ROUTES = /^\/(admin|display)(\/|$)/;

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, report: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, report: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidMount() {
    this.mounted = true;
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  componentDidCatch(error, errorInfo) {
    console.error("[TLS] Frontend-Fehler:", error, errorInfo);
    const report = { at: new Date(), path: window.location.pathname, id: null, pending: true };
    this.setState({ report });
    Promise.resolve(reportCaughtError(error, errorInfo?.componentStack))
      .catch(() => null)
      .then((id) => {
        // Inzwischen weitergeklickt oder ein anderer Fehler: die Kennung gehört nicht mehr hierher.
        if (this.mounted && this.state.error === error) this.setState({ report: { ...report, id: id || null, pending: false } });
      });
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.state.report) : this.props.children;
  }
}

/** Der Text zum Kopieren - ohne Zugangsdaten und E-Mail-Adressen, falls die Meldung welche enthält. */
export function technicalText(error, report) {
  const message = scrubClientLogText(`${error?.name || "Error"}: ${error?.message || "ohne Text"}`, 500);
  const lines = [
    `Fehler: ${message}`,
    `Seite: ${scrubClientLogText(report?.path || "-", 200)}`,
    `Uhrzeit: ${report?.at ? viennaDateTime(report.at) : "-"}`,
    `Kennung: ${report?.id || (report?.pending ? "wird gemeldet …" : "nicht gemeldet")}`,
  ];
  const version = import.meta.env.VITE_APP_VERSION;
  if (version) lines.push(`Version: ${version}`);
  return lines.join("\n");
}

function TechnicalDetails({ error, report, canSeeLogs }) {
  const [copied, setCopied] = useState("");
  const text = technicalText(error, report);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Kopiert");
    } catch {
      setCopied("Kopieren ging nicht – Text bitte markieren");
    }
  };
  return (
    <details className="mt-5 border border-white/10 bg-[#0A0A0A] rounded-sm text-left" data-testid="page-error-details">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white">
        Technische Angaben (für Admins)
      </summary>
      <div className="border-t border-white/10 px-3 py-3 space-y-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-white/70" data-testid="page-error-technical">{text}</pre>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-3 py-1.5 font-bold uppercase tracking-wider rounded-sm text-xs"
            data-testid="page-error-copy"
          >
            <ClipboardCopy className="w-4 h-4" /> Kopieren
          </button>
          {copied ? <span className="text-xs text-white/60" role="status" data-testid="page-error-copied">{copied}</span> : null}
          {canSeeLogs && report?.id ? (
            <Link to={`/admin/ops?tab=app&q=${encodeURIComponent(report.id)}`} className="text-xs text-[#29B6E8] hover:underline" data-testid="page-error-log-link">
              Unter „Betrieb &amp; Logs“ ansehen
            </Link>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function ErrorCard({ error, report }) {
  const auth = useOptionalAuth();
  const isAdmin = Boolean(auth?.user && auth?.isAdmin);
  return (
    <div className="max-w-xl w-full mx-auto border border-[#FF3B30]/30 bg-[#121212] rounded-sm p-6 text-center" role="alert" data-testid="page-error">
      <div className="mx-auto mb-5 w-14 h-14 rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 flex items-center justify-center text-[#FF3B30]">
        <AlertTriangle className="w-7 h-7" />
      </div>
      <h1 className="font-heading text-2xl md:text-3xl font-black uppercase">Diese Seite konnte nicht angezeigt werden</h1>
      <p className="mt-3 text-sm text-white/60">
        Lade die Seite neu. Hilft das nicht, probier es später noch einmal – der Rest der Website funktioniert weiter.
      </p>
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
          className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 font-bold uppercase tracking-wider rounded-sm text-xs"
        >
          <Home className="w-4 h-4" /> Startseite
        </Link>
      </div>
      {isAdmin ? <TechnicalDetails error={error} report={report} canSeeLogs={Boolean(auth?.can?.("system"))} /> : null}
    </div>
  );
}

function PlainScreen({ error, report }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center px-4 py-10">
      <ErrorCard error={error} report={report} />
    </div>
  );
}

export function AppErrorBoundary({ children }) {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}`;
  const plain = PLAIN_ROUTES.test(location.pathname);
  const fallback = (error, report) => (plain ? <PlainScreen error={error} report={report} /> : (
    <Boundary resetKey={resetKey} fallback={() => <PlainScreen error={error} report={report} />}>
      <PublicLayout>
        <section className="px-4 py-16">
          <ErrorCard error={error} report={report} />
        </section>
      </PublicLayout>
    </Boundary>
  ));
  return <Boundary resetKey={resetKey} fallback={fallback}>{children}</Boundary>;
}
