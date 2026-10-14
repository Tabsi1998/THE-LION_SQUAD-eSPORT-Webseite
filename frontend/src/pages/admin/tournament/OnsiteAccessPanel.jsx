import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Printer, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { viennaDateTime } from "@/lib/vienna";

// Vor-Ort-Zugang (#1592): Über den QR-Code auf TV und Aushang melden sich auch Nicht-Mitglieder an - nur im
// Zeitfenster (Öffnung der Anmeldung bzw. des Check-ins bis Turnierende). Vorgabe: an bei Turnieren vor Ort und hybrid,
// aus online. Den Code selbst zeigt nur der Aushang; hier stehen Zustand, an/aus und „Neuer Code“.

const WHEN = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };

export function windowText(window) {
  const from = window?.from ? viennaDateTime(window.from, WHEN) : "";
  const until = window?.until ? viennaDateTime(window.until, WHEN) : "";
  if (from && until) return `${from} bis ${until}`;
  if (from) return `ab ${from}, bis das Turnier endet`;
  if (until) return `ab Öffnung der Anmeldung bis ${until}`;
  return "ab Öffnung der Anmeldung, bis das Turnier endet";
}

export function OnsiteAccessPanel({ tournamentId }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/tournaments/${tournamentId}/onsite-access`);
      setState(data);
    } catch (error) {
      toast.error(formatRequestError(error, "Der Vor-Ort-Zugang konnte nicht geladen werden."));
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  const run = async (task, success, fallback) => {
    setBusy(true);
    try {
      const { data } = await task();
      setState(data);
      toast.success(success);
    } catch (error) {
      toast.error(formatRequestError(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => run(
    () => api.put(`/tournaments/${tournamentId}/onsite-access`, { enabled: !state.enabled }),
    state.enabled ? "Vor-Ort-Zugang abgeschaltet – QR-Codes gelten nicht mehr." : "Vor-Ort-Zugang eingeschaltet.",
    "Die Einstellung konnte nicht gespeichert werden.",
  );

  const renew = async () => {
    const ok = await confirm({
      title: "Neuen Vor-Ort-Code erzeugen?",
      description: "Gedruckte Aushänge und schon gescannte Codes gelten danach nicht mehr. Der TV zeigt sofort den neuen Code – den Aushang bitte neu drucken.",
      confirmLabel: "Neuer Code",
      tone: "danger",
    });
    if (!ok) return;
    await run(() => api.post(`/tournaments/${tournamentId}/onsite-access/renew`), "Neuer Vor-Ort-Code erzeugt.", "Der Code konnte nicht erneuert werden.");
  };

  if (!state) return null;
  const stateText = state.enabled ? (state.open_now ? "An – gilt gerade" : "An – gilt im Zeitfenster") : "Aus";
  return (
    <section className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4" data-testid="onsite-access-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="inline-flex items-center gap-2 font-heading text-lg font-bold uppercase"><QrCode className="w-4 h-4 text-[#29B6E8]" /> Vor-Ort-Anmeldung über QR</h3>
          <p className="mt-1 max-w-2xl text-sm text-white/65">
            Auch Nicht-Mitglieder (z. B. Begleitpersonen) melden sich über den QR-Code am TV oder am Aushang an. Danach sehen sie
            dieses Turnier – sonst nichts aus dem Mitgliederbereich.
          </p>
        </div>
        <span className={`shrink-0 text-xs font-bold uppercase tracking-wider ${state.enabled ? "text-[#00FF88]" : "text-white/50"}`} data-testid="onsite-access-state">{stateText}</span>
      </div>
      <p className="mt-3 text-xs text-white/60" data-testid="onsite-access-window">
        Zeitfenster: {windowText(state.window)}{state.explicit === null || state.explicit === undefined ? ` · Vorgabe (${state.default ? "an bei Turnieren vor Ort" : "aus bei Online-Turnieren"})` : ""}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} disabled={busy} data-testid="onsite-access-toggle" className={`tls-btn ${state.enabled ? "tls-btn--quiet" : "tls-btn--primary"} inline-flex min-h-[40px] items-center px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50`}>
          {state.enabled ? "Abschalten" : "Einschalten"}
        </button>
        <button type="button" onClick={renew} disabled={busy} data-testid="onsite-access-renew" className="tls-btn tls-btn--quiet inline-flex min-h-[40px] items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          <RefreshCw className="w-3.5 h-3.5" /> Neuer Code
        </button>
        <Link to={`/admin/tournaments/${tournamentId}/aushang`} data-testid="onsite-access-poster" className="tls-btn tls-btn--secondary inline-flex min-h-[40px] items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          <Printer className="w-3.5 h-3.5" /> Aushang drucken
        </Link>
      </div>
    </section>
  );
}

/** In der Teilnehmerliste der Leitung: angemeldet über den Vor-Ort-Zugang (#1592). */
export function OnsiteMark({ via }) {
  if (via !== "onsite") return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider align-middle" title="Über den QR-Code vor Ort angemeldet" data-testid="onsite-mark">
      <QrCode className="w-3 h-3" aria-hidden="true" /> Vor Ort
    </span>
  );
}
