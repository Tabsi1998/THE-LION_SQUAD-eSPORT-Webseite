import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { Download, AlertTriangle, ShieldOff, Users } from "lucide-react";
import { usePrompt } from "@/components/tls/ConfirmDialog";
import { formatWhen } from "@/lib/datetime";
import { useLoad } from "@/hooks/useLoad";
import { roleLabel } from "@/lib/permissions";

// Rechte an den eigenen Daten (DSGVO Art. 15-17) - seit „Mein Bereich“ (#2059) in Teilen an ihrem Ort: „Daten
// herunterladen“ und „Konto löschen“ als Reiter unter Datenschutz, die blockierten Konten bei der Sichtbarkeit, die
// Kontoangaben unter Konto & Sicherheit. Ein Name für eine Sache: „Konto löschen“ (vorher „Konto anonymisieren“) - wie in
// der App. Was dabei passiert, steht gleich darunter: die Daten werden überschrieben, Ergebnisse bleiben ohne Namen.

const cardClass = "border border-white/10 rounded-sm bg-[#121212] p-5 md:p-6";

/** Daten herunterladen: alles, was der Verein über dich gespeichert hat, als eine Datei. */
export function DatenHerunterladen() {
  const [busy, setBusy] = useState(false);
  const exportData = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/dsgvo/export-my-data");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tls-arena-meine-daten-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Deine Daten sind heruntergeladen.");
    } catch (err) { toast.error(formatRequestError(err, "Herunterladen fehlgeschlagen.")); }
    setBusy(false);
  };
  return (
    <div className={cardClass} data-testid="dsgvo-export">
      <div className="flex items-start gap-3">
        <Download className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="tls-type-section">Daten herunterladen</h2>
          <p className="mt-1 tls-type-body text-white/60">Lade alle Daten herunter, die wir über dich gespeichert haben – Profil, Turnier-Anmeldungen, Fast-Lap-Zeiten, Teams und E-Mail-Protokolle. Du hast jederzeit das Recht auf Auskunft und Datenübertragbarkeit (DSGVO Artikel 15 und 20).</p>
          <button type="button" onClick={exportData} disabled={busy} data-testid="dsgvo-export-btn" className="tls-btn tls-btn--primary mt-4 px-5 py-2.5 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
            {busy ? "Lade …" : "Daten herunterladen"}
          </button>
          <p className="mt-2 tls-type-small text-white/45">Eine Datei im JSON-Format, lesbar mit jedem Texteditor.</p>
        </div>
      </div>
    </div>
  );
}

// Dialog und Seite prüfen gleich (#2059): Leerzeichen am Rand zählen nicht - sonst ließe der Dialog „ LÖSCHEN “ durch
// und die Seite schlösse ihn still, ohne zu löschen.
const bestaetigt = (value) => String(value ?? "").trim() === "LÖSCHEN";

/** Konto löschen: unwiderruflich, mit Rückfrage. Rollen in Teams gibt man vorher ab (#2113) - der Weg steht dabei. */
export function KontoLoeschen() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const prompt = usePrompt();
  // Rollen in Teams (#2113, L-C5): wer Teamleitung, Co-Leitung, Captain oder Vertreter ist, gibt die Rolle vorher ab - die
  // Seite nennt je Rolle den Weg, statt erst nach dem Tippen von „LÖSCHEN“ zu scheitern. Der Server prüft selbst noch einmal.
  const erasure = useLoad(user?.id ? ["erasure-check", user.id] : null, ({ signal }) => (
    api.get("/dsgvo/anonymize-me/check", { signal }).then(({ data }) => data || {})
  ), { isEmpty: () => false });
  const roleBlockers = erasure.data?.blockers || [];

  const erase = async () => {
    if (roleBlockers.length) return;
    const answer = await prompt({
      title: "Konto löschen?",
      description: "Das lässt sich nicht rückgängig machen. Deine persönlichen Daten werden überschrieben.",
      // Sichtbare Beschriftung statt Platzhalter (#2059): ein leeres Feld sieht nicht wie schon ausgefüllt aus.
      label: "Tippe LÖSCHEN zur Bestätigung",
      validate: (value) => (bestaetigt(value) ? "" : "Bitte genau LÖSCHEN eintippen – in Großbuchstaben."),
      confirmLabel: "Konto löschen",
      tone: "danger",
      multiline: false,
      required: true,
    });
    if (!bestaetigt(answer)) return;
    setBusy(true);
    try {
      await api.post("/dsgvo/anonymize-me");
      toast.success("Dein Konto ist gelöscht.");
      // Erst zur Startseite, dann abmelden (#2059): ohne Konto leitet die geschützte Seite sonst sofort zur Anmeldung
      // weiter, bevor der Weg zur Startseite ankommt. `replace`: Zurück führt nicht auf die Seite des gelöschten Kontos.
      nav("/", { replace: true });
      // Der Server hat alle Sitzungen schon beendet: das Gerät wird auch bei Netzfehler geleert, und „Dein Konto ist
      // gelöscht.“ bleibt die einzige Meldung (AuthContext).
      await logout({ afterDelete: true });
      return;
    } catch (err) {
      toast.error(formatRequestError(err, "Das Konto konnte nicht gelöscht werden."));
      // Inzwischen eine Rolle bekommen (#2113): die Liste der Rollen frisch holen, damit der Weg dasteht.
      if (err?.response?.status === 409) erasure.reload();
    }
    setBusy(false);
  };

  const onlySuperadmin = roleBlockers.length > 0 && roleBlockers.every((row) => row.role === "superadmin");
  return (
    <div className="border border-live/30 rounded-sm bg-live/5 p-5 md:p-6" data-testid="dsgvo-erase">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-live mt-1 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="tls-type-section text-live">Konto löschen</h2>
          <p className="mt-1 tls-type-body text-white/60">Dein Konto wird dauerhaft deaktiviert und alle persönlichen Daten (E-Mail, Discord, Plattform-IDs, Bio, Avatar) werden überschrieben. Deine Turnier-Ergebnisse bleiben ohne Namen erhalten, damit Tabellen und Bäume stimmen. Das lässt sich <strong>nicht rückgängig machen</strong>.</p>
          {roleBlockers.length > 0 && (
            <div className="mt-4 border border-warn/35 bg-warn/5 rounded-sm p-4" data-testid="dsgvo-erasure-blockers">
              <div className="flex items-center gap-2 tls-type-label text-warn"><Users className="w-3.5 h-3.5" aria-hidden="true" /> {onlySuperadmin ? "Erst deine Rolle abgeben" : "Erst deine Rollen in Teams abgeben"}</div>
              <p className="mt-1 tls-type-small text-white/70">{onlySuperadmin ? "Als letzter Superadmin kannst du dein Konto nicht löschen – sonst vergibt niemand mehr Rollen. So geht es:" : "Solange du ein Team leitest oder in einem Co-Team Captain oder Vertreter bist, kannst du dein Konto nicht löschen – sonst stünde dort ein gelöschtes Konto. So geht es:"}</p>
              <ul className="mt-3 space-y-2">
                {roleBlockers.map((row) => (
                  <li key={`${row.team_id}:${row.squad_id || ""}:${row.role}`} className="border border-white/10 bg-black/20 rounded-sm p-3 tls-type-small" data-testid={`dsgvo-erasure-blocker-${row.role}`}>
                    <div className="font-bold text-white break-words">{row.role_label} {row.squad ? `im Co-Team ${row.squad} von ${row.team}` : `bei ${row.team}`}</div>
                    <div className="mt-1 text-white/60">{row.way}</div>
                    {row.link ? <Link to={row.link} className="tls-btn tls-btn--secondary mt-2 inline-flex min-h-11 items-center px-3 py-2 rounded-sm tls-type-label">{row.role === "superadmin" ? "Zu Alle Benutzer" : row.squad ? "Zu deinen Teams" : "Zur Teamseite"}</Link> : null}
                  </li>
                ))}
              </ul>
              {/* Kein Ende ohne Ausweg (#2113): der Löschanspruch hängt nie an einer Team-Rolle. */}
              {erasure.data?.closing ? <p className="mt-3 tls-type-small text-white/70" data-testid="dsgvo-erasure-closing">{erasure.data.closing}</p> : null}
            </div>
          )}
          <button type="button" onClick={erase} disabled={busy || roleBlockers.length > 0} data-testid="dsgvo-anonymize-btn" className="tls-btn tls-btn--danger mt-4 px-5 py-2.5 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50 disabled:cursor-not-allowed">
            Konto löschen
          </button>
        </div>
      </div>
    </div>
  );
}

/** Blockierte Konten: können dir weder schreiben noch Freundschaftsanfragen schicken. */
export function BlockierteBenutzer() {
  const [blocks, setBlocks] = useState([]);
  const loadBlocks = useCallback(async () => {
    try {
      const { data } = await api.get("/moderation/blocks");
      setBlocks(data || []);
    } catch { setBlocks([]); }
  }, []);
  useEffect(() => { loadBlocks(); }, [loadBlocks]);
  const unblock = async (userId) => {
    try {
      await api.delete(`/moderation/blocks/${userId}`);
      await loadBlocks();
      toast.success("Blockierung aufgehoben.");
    } catch (err) { toast.error(formatRequestError(err, "Blockierung konnte nicht aufgehoben werden.")); }
  };
  return (
    <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]" data-testid="dsgvo-blocks">
      <div className="flex items-start gap-3">
        <ShieldOff className="w-5 h-5 text-brand mt-1 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h3 className="tls-type-card mb-1">Blockierte Benutzer</h3>
          <p className="tls-type-small text-white/50">Blockierte Konten können dir keine Nachrichten oder Freundschaftsanfragen senden.</p>
          <div className="mt-4 divide-y divide-white/5 border border-white/10 rounded-sm">
            {blocks.map((row) => <div key={row.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0"><div className="font-bold tls-wrap">{row.user?.display_name || row.user?.username || "Gelöschter Benutzer"}</div>{row.user?.username && <div className="tls-type-small text-quiet tls-wrap">@{row.user.username}</div>}</div>
              <button type="button" onClick={() => unblock(row.blocked_id)} className="tls-btn tls-btn--quiet shrink-0 px-3 py-1.5 rounded-sm tls-type-label">Freigeben</button>
            </div>)}
            {blocks.length === 0 && <div className="p-4 tls-type-small text-white/45">Keine blockierten Benutzer.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Die Angaben zum Konto: Benutzername, E-Mail, Rolle, seit wann. */
export function KontoAngaben() {
  const { user } = useAuth();
  return (
    <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5 tls-type-small" data-testid="account-facts">
      <h3 className="tls-type-card mb-3">Dein Konto</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
        <dt className="text-white/45">Benutzername</dt><dd className="tls-wrap">{user?.username}</dd>
        <dt className="text-white/45">E-Mail</dt><dd className="tls-wrap">{user?.email}</dd>
        <dt className="text-white/45">Rolle</dt><dd className="text-[#29B6E8]" data-testid="privacy-account-role">{roleLabel(user?.role || "player")}</dd>
        <dt className="text-white/45">Registriert</dt><dd>{user?.created_at && formatWhen(user.created_at, { time: false })}</dd>
      </dl>
    </div>
  );
}
