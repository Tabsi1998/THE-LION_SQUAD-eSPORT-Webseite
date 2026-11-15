import { Component, useState } from "react";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { LoadNotice } from "@/components/tls/LoadState";
import { reportCaughtError } from "@/lib/clientLog";

// Fehlergrenzen (#944, #986). Eigene Datei seit #936: PublicLayout nutzt die stille Grenze für nachgeladene Teile
// (Glocke, Kronen-Feier); AppErrorBoundary.jsx importiert PublicLayout - hier gibt es darum keinen Kreis.

export class Boundary extends Component {
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

  reset = () => this.setState({ error: null, report: null });

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.state.report, this.reset) : this.props.children;
  }
}

/** Der kurze Hinweis an Stelle eines abgestürzten Teils: „Nochmal versuchen“ setzt die Grenze zurück. */
function OptionalNotice({ onRetry }) {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div className="fixed bottom-20 lg:bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-[85] flex items-stretch gap-1 bg-[#0F1012] rounded-sm shadow-lg">
      <LoadNotice testId="optional-error" className="flex-1" message="Dieser Teil konnte nicht geladen werden." onRetry={onRetry} />
      <button type="button" onClick={() => setClosed(true)} aria-label="Hinweis schließen" className="tls-hit shrink-0 px-2 text-white/50 hover:text-white">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Für optionale Teile über jeder Seite (#986): Abstimmung, Zeremonie, Adventkalender. Stürzt so ein Teil ab, fehlt
 * nur er - die Seite darunter bleibt bedienbar, der Fehler wird gemeldet, und an seiner Stelle steht ein kurzer
 * Hinweis mit „Nochmal versuchen“ (role="status"). Auf der nächsten Seite versucht er es ohnehin wieder.
 * `quiet` nur für Teile ohne eigene Aufgabe für die Person: reine Saison-Deko (Schnee, Ecken) und Hintergrund-Abgleiche
 * ohne Anzeige - dort hilft ein Hinweis niemandem, er würde nur auf jeder Seite stören. `placeholder` steht still an
 * seiner Stelle (etwa ein gleich großer Platz in der Kopfzeile, #936), sonst nichts.
 */
export function OptionalBoundary({ children, quiet = false, placeholder = null }) {
  const { pathname } = useLocation();
  const fallback = (_error, _report, reset) => (quiet ? placeholder : <OptionalNotice onRetry={reset} />);
  return <Boundary resetKey={pathname} fallback={fallback}>{children}</Boundary>;
}
