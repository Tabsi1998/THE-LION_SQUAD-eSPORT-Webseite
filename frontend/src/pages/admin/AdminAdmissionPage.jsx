import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Info, ScanLine, Undo2, XCircle } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { QrScanner } from "@/components/tls/QrScanner";

// Einlass bei der Generalversammlung (#845): Mitgliedskarte scannen oder Mitgliedsnummer eintippen. Groß steht, was
// passiert ist; darüber die Zahlen zur Beschlussfähigkeit; darunter die letzten Einlässe mit Rücknahme (nur mit Grund).
// Ob die scannende Person heute im Vorstand ist, entscheidet das Vereinsmodul bei jedem Einlass.

const TONES = {
  ok: { box: "border-[#00FF88]/50 bg-[#00FF88]/10", text: "text-[#00FF88]", Icon: CheckCircle2 },
  info: { box: "border-[#FFD700]/50 bg-[#FFD700]/10", text: "text-[#FFD700]", Icon: Info },
  error: { box: "border-[#FF3B30]/50 bg-[#FF3B30]/10", text: "text-[#FF3B30]", Icon: XCircle },
};

export function quorumText(counts) {
  if (!counts) return "Noch niemand eingelassen.";
  const state = counts.quorum_reached ? "beschlussfähig" : "noch nicht beschlussfähig";
  return `${counts.present} anwesend · ${counts.eligible} stimmberechtigt eingeladen · beschlussfähig ab ${counts.quorum_from} Stimmen – ${state}`;
}

function ResultCard({ result }) {
  if (!result) return null;
  const tone = TONES[result.tone] || TONES.info;
  return (
    <div className={`border rounded-sm p-5 ${tone.box}`} data-testid="admission-result" role="status" aria-live="polite">
      <div className={`flex items-center gap-3 font-heading text-2xl sm:text-3xl font-black ${tone.text}`}>
        <tone.Icon className="w-8 h-8 shrink-0" /> {result.headline}
      </div>
      {result.detail ? <div className="mt-1 text-base text-white/80">{result.detail}</div> : null}
    </div>
  );
}

export default function AdminAdmissionPage() {
  const [view, setView] = useState(null);
  const [meetingId, setMeetingId] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState("");
  const [undoFor, setUndoFor] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/admission");
      setView(data);
      setMeetingId((current) => current ?? data.meetings?.[0]?.id ?? null);
    } catch (err) {
      setView({ ready: false, text: formatApiError(err.response?.data?.detail) || "Der Einlass ist gerade nicht erreichbar.", meetings: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const meeting = (view?.meetings || []).find((item) => item.id === meetingId) || null;

  const patchMeeting = (id, change) => setView((current) => ({
    ...current,
    meetings: (current?.meetings || []).map((item) => (item.id === id ? change(item) : item)),
  }));

  const remember = (id, data) => patchMeeting(id, (item) => ({
    ...item,
    counts: data.counts || item.counts,
    recent: [data.admission, ...(item.recent || []).filter((row) => row.member_id !== data.admission.member_id)].slice(0, 20),
  }));

  const admit = async (payload) => {
    if (!meeting || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/admission/${meeting.id}/scan`, payload);
      setResult({ tone: data.admission?.voting ? "ok" : "info", headline: data.headline, detail: data.detail });
      remember(meeting.id, data);
      if (payload.number) setNumber("");
    } catch (err) {
      setResult({ tone: "error", headline: "Nicht eingelassen", detail: formatApiError(err.response?.data?.detail) || "Dolibarr hat nicht geantwortet." });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (row) => {
    if (!meeting || busy || !reason.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/admission/${meeting.id}/undo`, { member_id: row.member_id, reason: reason.trim() });
      remember(meeting.id, data);
      setResult({ tone: "info", headline: `Zurückgenommen: ${row.name}`, detail: `Grund: ${reason.trim()}` });
      setUndoFor(null);
      setReason("");
    } catch (err) {
      setResult({ tone: "error", headline: "Nicht zurückgenommen", detail: formatApiError(err.response?.data?.detail) || "Dolibarr hat nicht geantwortet." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-5" data-testid="admission-page">
        <div>
          <h1 className="font-heading text-3xl font-black uppercase flex items-center gap-3"><ScanLine className="w-7 h-7 text-[#29B6E8]" /> Einlass</h1>
          <p className="text-sm text-white/55 mt-1">
            Generalversammlung: Mitgliedskarte am Eingang scannen – die Anwesenheit steht sofort in Dolibarr, mit Stimmrecht und Beschlussfähigkeit.
            Einlassen darf, wer am Tag im Vorstand ist.
          </p>
        </div>

        {!view ? <div className="text-sm text-white/45">Lade …</div> : null}
        {view && !view.ready ? (
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5 text-sm text-white/70" data-testid="admission-not-ready">{view.text}</div>
        ) : null}

        {meeting ? (
          <>
            {view.meetings.length > 1 ? (
              <select value={meeting.id} onChange={(e) => setMeetingId(Number(e.target.value))} data-testid="admission-meeting"
                className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                {view.meetings.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.time}</option>)}
              </select>
            ) : null}
            <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="admission-meeting-card">
              <div className="font-bold">{meeting.title}{meeting.time ? ` · ${meeting.time}` : ""}{meeting.place ? ` · ${meeting.place}` : ""}</div>
              <div className={`text-sm mt-1 ${meeting.counts?.quorum_reached ? "text-[#00FF88]" : "text-[#FFD700]"}`} data-testid="admission-counts">{quorumText(meeting.counts)}</div>
            </div>

            <ResultCard result={result} />

            <QrScanner onCode={(code) => admit({ code })} paused={busy} />

            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (number.trim()) admit({ number: number.trim() }); }}>
              <label className="text-[11px] font-bold uppercase tracking-widest text-white/65">
                Ohne Karte: Mitgliedsnummer
                <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" data-testid="admission-number"
                  className="mt-1 block w-48 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-normal normal-case tracking-normal text-white" />
              </label>
              <button type="submit" disabled={busy || !number.trim()} data-testid="admission-number-submit"
                className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
                Einlassen
              </button>
            </form>

            <div>
              <h2 className="font-heading text-lg font-black uppercase">Zuletzt</h2>
              {(meeting.recent || []).length ? (
                <ul className="mt-2 divide-y divide-white/5 border border-white/10 rounded-sm" data-testid="admission-recent">
                  {meeting.recent.map((row) => (
                    <li key={row.member_id} className="p-3 text-sm" data-testid={`admission-row-${row.member_id}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-bold">{row.name}</span>
                        <span className={row.state === "present" ? "text-white/60" : "text-white/40 line-through"}>
                          {row.state === "present" ? `${row.arrived ? `ab ${row.arrived} · ` : ""}${row.reason_text}` : `zurückgenommen${row.undo_reason ? `: ${row.undo_reason}` : ""}`}
                        </span>
                        {row.state === "present" ? (
                          <button type="button" onClick={() => { setUndoFor(row.member_id); setReason(""); }} data-testid={`admission-undo-${row.member_id}`}
                            className="ml-auto text-[11px] font-bold uppercase tracking-wider text-white/60 hover:text-white inline-flex items-center gap-1">
                            <Undo2 className="w-3.5 h-3.5" /> Zurücknehmen
                          </button>
                        ) : null}
                      </div>
                      {undoFor === row.member_id ? (
                        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); undo(row); }}>
                          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund, z. B. falscher Ausweis" maxLength={200}
                            data-testid="admission-undo-reason" className="flex-1 min-w-48 bg-[#0A0A0A] border border-white/10 px-3 py-1.5 rounded-sm text-sm" />
                          <button type="submit" disabled={busy || !reason.trim()} data-testid="admission-undo-confirm"
                            className="px-3 py-1.5 border border-[#FF3B30]/50 text-[#FF3B30] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
                            Rücknahme bestätigen
                          </button>
                          <button type="button" onClick={() => setUndoFor(null)} className="text-[11px] text-white/50 hover:text-white">Abbrechen</button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/45 mt-1">Noch niemand eingelassen.</p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
