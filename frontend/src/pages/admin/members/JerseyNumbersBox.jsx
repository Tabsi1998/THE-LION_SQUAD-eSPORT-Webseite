import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { viennaDate } from "@/lib/vienna";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { jerseyRequestLine, parseJerseyInput } from "@/lib/jerseyNumber";

// Nummern der Mitglieder (#2034): vergebene Nummern mit Stand in Dolibarr, offene Anträge, Nummern nur in Dolibarr und
// die Regeln (Bereich, reservierte Nummern, Feldname in Dolibarr). Nur für den Vorstand (Bereich „club“).

const day = (iso) => (iso ? viennaDate(iso, { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const SET_BY = { member: "selbst gewählt", board: "vom Vorstand", dolibarr: "aus Dolibarr" };
const SYNC_TONE = { ok: "text-ok", off: "text-white/40", pending: "text-white/50" };
const ACTIONS = {
  chosen: "gewählt", requested: "Antrag gestellt", set_by_board: "vom Vorstand gesetzt", reopened: "Neuwahl freigegeben",
  rejected: "Antrag abgelehnt", released_exit: "frei nach Austritt", adopted: "aus Dolibarr übernommen",
};
const input = "bg-[#0A0A0A] border border-white/10 focus:border-honor rounded-sm text-white text-sm px-3 py-2 focus:outline-none";
const small = "tls-btn px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";

function numberText(value) {
  return value === null || value === undefined ? "–" : String(value);
}

function SettingsForm({ settings, onSaved }) {
  const [form, setForm] = useState({ min: String(settings.min), max: String(settings.max), reserved: settings.reserved.join(", "), dolibarr_field: settings.dolibarr_field });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put("/admin/jersey-numbers/settings", form);
      toast.success("Regeln gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatRequestError(err, "Speichern hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="border border-white/10 rounded-sm bg-[#121212] p-4 space-y-3" data-testid="jersey-settings">
      <h3 className="font-heading text-sm font-black uppercase">Regeln</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-white/60">Von
          <input value={form.min} onChange={(e) => set("min", e.target.value)} inputMode="numeric" data-testid="jersey-settings-min" className={`${input} mt-1 w-full`} />
        </label>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-white/60">Bis
          <input value={form.max} onChange={(e) => set("max", e.target.value)} inputMode="numeric" data-testid="jersey-settings-max" className={`${input} mt-1 w-full`} />
        </label>
        <label className="col-span-2 block text-[11px] font-bold uppercase tracking-widest text-white/60">Reserviert (nicht wählbar)
          <input value={form.reserved} onChange={(e) => set("reserved", e.target.value)} placeholder="z. B. 0, 13" data-testid="jersey-settings-reserved" className={`${input} mt-1 w-full normal-case tracking-normal font-normal`} />
        </label>
      </div>
      <label className="block text-[11px] font-bold uppercase tracking-widest text-white/60">Feld in Dolibarr (ergänzendes Attribut beim Mitglied)
        <input value={form.dolibarr_field} onChange={(e) => set("dolibarr_field", e.target.value)} data-testid="jersey-settings-field" className={`${input} mt-1 w-full sm:w-72 font-mono normal-case tracking-normal font-normal`} />
      </label>
      <p className="text-xs text-white/45">
        In Dolibarr: Einrichtung → Module/Anwendungen → Mitglieder (Zahnrad) → Ergänzende Attribute (Mitglieder) → neues Attribut mit genau diesem Code, Typ „Ganzzahl“ (Integer).
        Eine Nummer außerhalb des Bereichs bleibt bestehen, bis sie jemand ändert.
      </p>
      <button type="submit" disabled={busy} data-testid="jersey-settings-save" className={`${small} tls-btn--secondary`}>{busy ? "Speichere …" : "Regeln speichern"}</button>
    </form>
  );
}

function RequestCard({ row, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/admin/jersey-numbers/requests/${row.id}/decision`, { decision, reason });
      toast.success(decision === "reject" ? "Antrag abgelehnt." : decision === "reopen" ? "Neuwahl freigegeben." : "Antrag freigegeben.");
      onDone();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border border-honor/30 rounded-sm bg-honor/5 p-4" data-testid={`jersey-request-${row.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-bold text-white break-words min-w-0">{row.name}</div>
        <div className="text-xs text-white/45">{day(row.received_at)}</div>
      </div>
      <div className="mt-1 text-sm text-white/80">{jerseyRequestLine(row)}</div>
      {row.reason && <p className="mt-1 text-sm text-white/60 break-words">„{row.reason}“</p>}
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Begründung (optional, sieht das Mitglied)" className={`${input} mt-3 w-full`} />
      <div className="mt-3 flex flex-wrap gap-2">
        {row.wished !== null && row.wished !== undefined && (
          <button type="button" disabled={busy} onClick={() => decide("approve")} data-testid={`jersey-approve-${row.id}`} className={`${small} tls-btn--primary`}>{row.wished} freigeben</button>
        )}
        <button type="button" disabled={busy} onClick={() => decide("reopen")} data-testid={`jersey-reopen-request-${row.id}`} className={`${small} tls-btn--secondary`}>Neuwahl erlauben</button>
        <button type="button" disabled={busy} onClick={() => decide("reject")} data-testid={`jersey-reject-${row.id}`} className={`${small} tls-btn--danger`}>Ablehnen</button>
      </div>
    </div>
  );
}

function MemberRow({ row, range, onChanged }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const local = parseJerseyInput(value, range);

  useEffect(() => {
    if (!editing || local.value === null || local.error) { setCheck(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.get("/admin/jersey-numbers/check", { params: { number: String(local.value), user_id: row.user_id }, signal: controller.signal })
        .then(({ data }) => setCheck(data)).catch(() => {});
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editing, local.value, local.error, row.user_id]);

  const save = async (event) => {
    event.preventDefault();
    if (local.value === null || local.error) return;
    setBusy(true);
    try {
      await api.put(`/admin/jersey-numbers/members/${row.user_id}`, { number: local.value });
      toast.success("Nummer eingetragen.");
      setEditing(false);
      setValue("");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    const ok = await confirm({
      title: `Neuwahl für ${row.name}?`,
      description: row.number === null ? "Das Mitglied darf sich dann einmal selbst eine Nummer aussuchen." : `Die ${row.number} wird sofort frei, und das Mitglied darf sich einmal eine neue aussuchen.`,
      confirmLabel: "Neuwahl erlauben",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/admin/jersey-numbers/members/${row.user_id}/reopen`, {});
      toast.success("Neuwahl freigegeben.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  const hint = local.error || (check ? (check.free || check.reason === "own" ? "frei" : check.text) : "");

  return (
    <li className="px-4 py-3" data-testid={`jersey-row-${row.username || row.user_id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-14 shrink-0 font-heading text-2xl font-black tabular-nums text-honor" data-testid="jersey-row-number">{numberText(row.number)}</div>
        <div className="min-w-0 flex-1 basis-40">
          <div className="font-bold text-white break-words">{row.name}</div>
          <div className="text-[11px] text-white/45 break-words">
            {row.number === null ? (row.can_choose ? "wählt noch selbst" : "keine Nummer") : `${SET_BY[row.set_by] || ""}${row.chosen_at ? ` · ${day(row.chosen_at)}` : ""}`}
            {row.outside_rules ? " · außerhalb der Regeln" : ""}
          </div>
          {row.dolibarr && row.number !== null && (
            <div className={`text-[11px] ${SYNC_TONE[row.dolibarr.state] || "text-warn"}`} data-testid="jersey-row-sync">{row.dolibarr.text}</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing((v) => !v)} disabled={busy} data-testid="jersey-row-edit" className={`${small} tls-btn--secondary`}>{editing ? "Schließen" : row.number === null ? "Vergeben" : "Ändern"}</button>
          <button type="button" onClick={reopen} disabled={busy} data-testid="jersey-row-reopen" className={`${small} tls-btn--quiet`}>Neuwahl</button>
          {!!row.log?.length && (
            <button type="button" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} className={`${small} tls-btn--quiet inline-flex items-center gap-1`}><History className="w-3 h-3" /> Verlauf</button>
          )}
        </div>
      </div>
      {editing && (
        <form onSubmit={save} className="tls-reveal mt-3 flex flex-wrap items-center gap-2">
          <input value={value} onChange={(e) => setValue(e.target.value.replace(/\s+/g, "").slice(0, 4))} inputMode="numeric" aria-label={`Neue Nummer für ${row.name}`}
            data-testid="jersey-row-input" className={`${input} w-24 text-center font-heading text-lg font-black tabular-nums`} />
          <button type="submit" disabled={busy || local.value === null || !!local.error || (check && !check.free && check.reason !== "own")} data-testid="jersey-row-save" className={`${small} tls-btn--primary`}>Eintragen</button>
          <span className="text-xs text-white/55" aria-live="polite">{hint}</span>
        </form>
      )}
      {showLog && (
        <ol className="tls-reveal mt-3 space-y-1 border-l-2 border-white/10 pl-3 text-xs text-white/60">
          {row.log.map((entry, i) => (
            <li key={`${entry.at}-${i}`}>
              {day(entry.at)} · {ACTIONS[entry.action] || entry.action}
              {entry.from !== entry.to ? ` · ${numberText(entry.from)} → ${numberText(entry.to)}` : ""}
              {entry.note ? ` · ${entry.note}` : ""}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function JerseyNumbersBox() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(() => {
    api.get("/admin/jersey-numbers").then(({ data: next }) => { setData(next); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data: next } = await api.post("/admin/jersey-numbers/sync");
      setData(next.overview);
      toast.success("Abgleich mit Dolibarr gelaufen.");
    } catch (err) {
      toast.error(formatRequestError(err, "Der Abgleich hat nicht geklappt."));
    } finally {
      setSyncing(false);
    }
  };

  if (failed && !data) {
    return (
      <div className="border border-honor/30 rounded-sm p-4" role="alert">
        <div className="text-sm text-white/80">Die Nummern wurden nicht geladen.</div>
        <button type="button" onClick={load} className={`${small} tls-btn--secondary mt-3`}>Nochmal versuchen</button>
      </div>
    );
  }
  if (!data) return <div className="text-sm text-white/50" data-testid="jersey-loading">Lade Nummern …</div>;

  const { counts, settings } = data;
  const open = data.requests.filter((row) => row.status === "received");
  const pending = data.rows.some((row) => row.number !== null && row.dolibarr && !["ok", "off"].includes(row.dolibarr.state));
  const range = { min: settings.min, max: settings.max };

  return (
    <div className="space-y-6" data-testid="jersey-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/70" data-testid="jersey-counts">
          <strong className="text-white">{counts.taken}</strong> vergeben · <strong className="text-white">{counts.free}</strong> frei
          {counts.reserved ? ` · ${counts.reserved} reserviert` : ""} · Bereich {settings.min}–{settings.max}. Nicht öffentlich – nur Mitglied und Vorstand sehen die Nummer.
        </p>
        {(pending || data.dolibarr.state === "failed") && (
          <button type="button" onClick={sync} disabled={syncing} data-testid="jersey-sync-now" className={`${small} tls-btn--secondary inline-flex items-center gap-1.5`}>
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`} /> Nach Dolibarr übertragen
          </button>
        )}
      </div>
      {data.dolibarr.text && <p className="text-xs text-warn" data-testid="jersey-dolibarr-warning">{data.dolibarr.text}</p>}
      {!!data.duplicates.length && (
        <p className="text-xs text-warn" data-testid="jersey-duplicates">In Dolibarr steht dieselbe Nummer bei mehreren aktiven Mitgliedern: {data.duplicates.join(", ")}. Bitte dort bereinigen.</p>
      )}

      {open.length > 0 && (
        <section className="space-y-3" data-testid="jersey-open-requests">
          <h3 className="font-heading text-sm font-black uppercase">Offene Anträge ({open.length})</h3>
          <div className="grid gap-3 md:grid-cols-2">{open.map((row) => <RequestCard key={row.id} row={row} onDone={load} />)}</div>
        </section>
      )}

      <section>
        <h3 className="font-heading text-sm font-black uppercase mb-3">Mitglieder</h3>
        {data.rows.length ? (
          <ul className="border border-white/10 rounded-sm bg-[#121212] divide-y divide-white/5" data-testid="jersey-rows">
            {data.rows.map((row) => <MemberRow key={row.user_id} row={row} range={range} onChanged={load} />)}
          </ul>
        ) : (
          <p className="text-sm text-white/50" data-testid="jersey-empty">Noch keine Mitglieder – sobald jemand Mitglied ist, steht er hier.</p>
        )}
      </section>

      {!!data.dolibarr_only.length && (
        <section data-testid="jersey-dolibarr-only">
          <h3 className="font-heading text-sm font-black uppercase mb-2">Nur in Dolibarr</h3>
          <p className="text-xs text-white/45 mb-2">Mitglieder ohne zugeordnetes Website-Konto. Ihre Nummern gelten als vergeben.</p>
          <ul className="flex flex-wrap gap-2">
            {data.dolibarr_only.map((row) => (
              <li key={`${row.number}-${row.member_id}`} className="px-2.5 py-1 border border-white/10 rounded-sm text-xs text-white/70">
                <span className="font-heading font-black text-honor">{row.number}</span> · Mitglied {row.member_id}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.requests.some((row) => row.status !== "received") && (
        <details className="text-sm text-white/60">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-widest">Entschiedene Anträge</summary>
          <ul className="mt-2 space-y-1">
            {data.requests.filter((row) => row.status !== "received").map((row) => (
              <li key={row.id} className="break-words">{day(row.decided_at)} · {row.name} · {jerseyRequestLine(row)} · {row.status_label}{row.decision_reason ? ` – ${row.decision_reason}` : ""}</li>
            ))}
          </ul>
        </details>
      )}

      <SettingsForm key={JSON.stringify(settings)} settings={settings} onSaved={load} />
    </div>
  );
}
