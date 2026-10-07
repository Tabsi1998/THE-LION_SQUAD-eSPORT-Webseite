import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { BENEFIT_ICON_LABELS, DEFAULT_JOIN_BENEFITS } from "@/lib/membershipFees";

// Die Seite „Mitglied werden“ (#1251, #1335): die vier Vorteils-Kacheln (Symbol, Titel, ein Satz) und der Satz, wofür der
// Beitrag verwendet wird. Die Beträge selbst kommen aus Dolibarr und werden nur dort gepflegt.

const EMPTY = { icon: "star", title: "", text: "" };

/** Immer vier Zeilen zum Ausfüllen - leere fallen beim Speichern weg. */
export function fourRows(benefits) {
  const rows = (benefits?.length ? benefits : DEFAULT_JOIN_BENEFITS).map((row) => ({ icon: row.icon || "star", title: row.title || "", text: row.text || "" }));
  return [...rows, EMPTY, EMPTY, EMPTY, EMPTY].slice(0, 4);
}

export function JoinPageBox() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/membership/join-page").then(({ data }) => setForm({ fee_purpose: data?.fee_purpose || "", benefits: fourRows(data?.benefits) })).catch(() => setForm(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!form) return null;
  const setBenefit = (index, patch) => setForm((current) => ({ ...current, benefits: current.benefits.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/membership/join-page", {
        fee_purpose: form.fee_purpose.trim(),
        benefits: form.benefits.map((row) => ({ icon: row.icon, title: row.title.trim(), text: row.text.trim() })).filter((row) => row.title),
      });
      toast.success("„Mitglied werden“ gespeichert.");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Speichern hat nicht geklappt.");
    }
    setBusy(false);
  };

  return (
    <details className="mt-6 border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="join-page-box">
      <summary className="cursor-pointer select-none">
        <span className="font-heading font-bold uppercase">Seite „Mitglied werden“</span>
        <span className="block text-xs text-white/50 mt-1">Vier Vorteile mit Symbol und je einem Satz, dazu wofür der Beitrag verwendet wird. Die Beträge kommen aus Dolibarr. <Link to="/membership/join" target="_blank" className="text-[#29B6E8] hover:text-white">Ansehen</Link></span>
      </summary>
      <div className="mt-4 space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          {form.benefits.map((row, index) => (
            <div key={index} className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`join-page-benefit-${index}`}>
              <div className="flex gap-2">
                <select value={row.icon} onChange={(e) => setBenefit(index, { icon: e.target.value })} aria-label={`Symbol für Vorteil ${index + 1}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm">
                  {Object.entries(BENEFIT_ICON_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <input value={row.title} maxLength={60} placeholder="Stimmrecht im Verein" aria-label={`Vorteil ${index + 1}`} data-testid={`join-page-benefit-title-${index}`}
                  onChange={(e) => setBenefit(index, { title: e.target.value })} className="flex-1 min-w-0 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" />
              </div>
              <input value={row.text} maxLength={200} placeholder="Ein Satz dazu" aria-label={`Satz zu Vorteil ${index + 1}`}
                onChange={(e) => setBenefit(index, { text: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" />
            </div>
          ))}
        </div>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/65">Wofür der Beitrag verwendet wird (ein Satz)</span>
          <input value={form.fee_purpose} onChange={(e) => setForm((current) => ({ ...current, fee_purpose: e.target.value }))} maxLength={300} data-testid="join-page-purpose"
            placeholder="Der Beitrag zahlt Hallenmiete, Turnierpreise und Technik." className="mt-1 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
        </label>
        <button type="button" onClick={save} disabled={busy} data-testid="join-page-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">Speichern</button>
      </div>
    </details>
  );
}
