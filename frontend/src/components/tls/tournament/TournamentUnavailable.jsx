import { PublicEmptyState, PublicErrorState } from "@/components/tls/PublicEmptyState";

// Turnierseite ohne Turnier (#1939): statt ewig „Lade Turnier“ eine Meldung je Fall (lib/loadProblem). Was der Server
// meldet, gilt - ein verborgenes Turnier meldet er wie ein unbekanntes (404), Fremde erfahren also nicht, ob es existiert.
// 403 heißt: nur für Mitglieder bzw. über den Vor-Ort-Zugang (QR-Code) sichtbar.

const LIST = { to: "/tournaments", label: "Zur Turnierliste" };

export function TournamentUnavailable({ kind, user = null, loginHref = "/login", onRetry }) {
  if (kind === "notFound") {
    return (
      <PublicEmptyState
        art="search"
        title="Turnier nicht gefunden"
        description="Vielleicht ein Tippfehler im Link – alle Turniere stehen in der Turnierliste."
        primaryAction={LIST}
      />
    );
  }
  if (kind === "denied") {
    return (
      <PublicEmptyState
        art="sleep"
        title="Dieses Turnier ist nur für Mitglieder bzw. über den QR-Code vor Ort sichtbar"
        description="QR-Code am Eingang scannen."
        primaryAction={user ? LIST : { to: loginHref, label: "Anmelden" }}
        secondaryAction={user ? null : LIST}
      />
    );
  }
  return <PublicErrorState kind={kind} title={kind === "offline" ? undefined : "Das Turnier konnte nicht geladen werden"} onRetry={onRetry} />;
}

export default TournamentUnavailable;
