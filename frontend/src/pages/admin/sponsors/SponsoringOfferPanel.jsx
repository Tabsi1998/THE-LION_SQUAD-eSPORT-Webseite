import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2, Upload } from "lucide-react";
import { api, formatApiError } from "@/lib/api";

// Sponsor werden (#1254) pflegen: Einleitung, Zahlen (selbst eingetragen oder von der Website gezählt), welche Stufen die
// Tabelle zeigt, was jede Stufe bekommt, und die Mappe als PDF. Leer gelassen bleibt auf der Sponsoren-Seite die kleine
// Karte „Sponsor werden“ zum Kontaktformular.

const TIER_LABELS = { main: "Hauptsponsor", platinum: "Platin", gold: "Gold", silver: "Silber", bronze: "Bronze" };

export function offerToForm(data) {
  return {
    intro: data?.intro || "",
    numbers: (data?.numbers || []).map((row) => ({ value: row.value || "", label: row.label || "" })),
    auto_numbers: [...(data?.auto_numbers || [])],
    tiers: [...(data?.tiers || ["gold", "silver", "bronze"])],
    benefits: (data?.benefits || []).map((row) => ({ label: row.label || "", tiers: [...(row.tiers || [])] })),
  };
}

export function formToOffer(form) {
  return {
    intro: form.intro.trim(),
    numbers: form.numbers.map((row) => ({ value: row.value.trim(), label: row.label.trim() })).filter((row) => row.value && row.label),
    auto_numbers: form.auto_numbers,
    tiers: form.tiers,
    benefits: form.benefits.map((row) => ({ label: row.label.trim(), tiers: row.tiers.filter((tier) => form.tiers.includes(tier)) })).filter((row) => row.label),
  };
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function SponsoringOfferPanel() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/sponsoring/offer/admin").then(({ data: offer }) => { setData(offer); setForm(offerToForm(offer)); }).catch(() => setData({ unavailable: true }));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return null;
  if (data.unavailable || !form) return null;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setRow = (key, index, patch) => setForm((current) => ({ ...current, [key]: current[key].map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  const removeRow = (key, index) => setForm((current) => ({ ...current, [key]: current[key].filter((_, i) => i !== index) }));
  const tiers = data.all_tiers || Object.keys(TIER_LABELS);

  const save = async () => {
    setBusy(true);
    try {
      const { data: saved } = await api.put("/sponsoring/offer/admin", formToOffer(form));
      setData(saved);
      setForm(offerToForm(saved));
      toast.success("„Sponsor werden“ gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Speichern hat nicht geklappt.");
    }
    setBusy(false);
  };
  const uploadPdf = async (file) => {
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const { data: saved } = await api.post("/sponsoring/offer/pdf", body);
      setData(saved);
      toast.success("Mappe hochgeladen.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Hochladen hat nicht geklappt.");
    }
    setBusy(false);
  };
  const removePdf = async () => {
    setBusy(true);
    try {
      const { data: saved } = await api.delete("/sponsoring/offer/pdf");
      setData(saved);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Löschen hat nicht geklappt.");
    }
    setBusy(false);
  };

  return (
    <details className="mb-6 border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="sponsoring-offer-panel">
      <summary className="cursor-pointer select-none">
        <span className="font-heading font-bold uppercase">Sponsor werden</span>
        <span className="block text-xs text-white/50 mt-1">Was Interessierte auf der Sponsoren-Seite sehen: Zahlen, was jede Stufe bekommt, „Unterlagen anfordern“ und die Mappe. Leer: die kleine Karte zum Kontaktformular. <Link to="/sponsors#sponsor-werden" target="_blank" className="text-[#29B6E8] hover:text-white">Ansehen</Link></span>
      </summary>
      <div className="mt-4 space-y-5 text-sm">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/65">Einleitung</span>
          <textarea value={form.intro} onChange={(e) => set("intro", e.target.value)} maxLength={600} rows={3} data-testid="sponsoring-intro" className="mt-1 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
        </label>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/65">Zahlen – nur echte</div>
          <p className="text-xs text-white/45 mt-1">Von der Website gezählt (Stand jetzt):</p>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {Object.entries(data.auto_labels || {}).map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.auto_numbers.includes(key)} onChange={() => set("auto_numbers", toggle(form.auto_numbers, key))} data-testid={`sponsoring-auto-${key}`} className="accent-[#29B6E8]" />
                {label} <span className="text-white/45">({data.counted?.[key] ?? 0})</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-white/45 mt-3">Selbst eingetragen (z. B. „2.400“ / „Besuche im Monat“ aus der Statistik):</p>
          {form.numbers.map((row, index) => (
            <div key={index} className="mt-1 flex gap-2" data-testid={`sponsoring-number-${index}`}>
              <input value={row.value} onChange={(e) => setRow("numbers", index, { value: e.target.value })} maxLength={12} placeholder="2.400" aria-label="Zahl" className="w-24 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" />
              <input value={row.label} onChange={(e) => setRow("numbers", index, { label: e.target.value })} maxLength={40} placeholder="Besuche im Monat" aria-label="Bezeichnung" className="flex-1 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" />
              <button type="button" onClick={() => removeRow("numbers", index)} aria-label="Zahl entfernen" className="p-1.5 border border-white/10 rounded-sm text-white/60"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {form.numbers.length < 4 && <button type="button" onClick={() => set("numbers", [...form.numbers, { value: "", label: "" }])} data-testid="sponsoring-number-add" className="mt-2 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8]"><Plus className="w-3.5 h-3.5" /> Zahl</button>}
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/65">Stufen in der Tabelle</div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {tiers.map((tier) => (
              <label key={tier} className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.tiers.includes(tier)} onChange={() => set("tiers", toggle(form.tiers, tier))} data-testid={`sponsoring-tier-${tier}`} className="accent-[#29B6E8]" />
                {TIER_LABELS[tier] || tier}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/65">Was jede Stufe bekommt</div>
          {form.benefits.map((row, index) => (
            <div key={index} className="mt-2 border border-white/10 rounded-sm p-2 space-y-2" data-testid={`sponsoring-benefit-${index}`}>
              <div className="flex gap-2">
                <input value={row.label} onChange={(e) => setRow("benefits", index, { label: e.target.value })} maxLength={120} placeholder="Logo auf TV und Beamer bei jeder LAN" aria-label="Leistung" className="flex-1 bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" />
                <button type="button" onClick={() => removeRow("benefits", index)} aria-label="Leistung entfernen" className="p-1.5 border border-white/10 rounded-sm text-white/60"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {form.tiers.map((tier) => (
                  <label key={tier} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={row.tiers.includes(tier)} onChange={() => setRow("benefits", index, { tiers: toggle(row.tiers, tier) })} className="accent-[#29B6E8]" aria-label={`${row.label || "Leistung"}: ${TIER_LABELS[tier] || tier}`} />
                    {TIER_LABELS[tier] || tier}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => set("benefits", [...form.benefits, { label: "", tiers: [...form.tiers] }])} data-testid="sponsoring-benefit-add" className="mt-2 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8]"><Plus className="w-3.5 h-3.5" /> Leistung</button>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/65">Mappe als PDF (optional)</div>
          {data.pdf_key ? (
            <div className="mt-1 flex items-center gap-3 text-xs" data-testid="sponsoring-pdf">
              <span className="text-white/75">{data.pdf_name}</span>
              <button type="button" onClick={removePdf} disabled={busy} className="text-[#FF6B6B] hover:underline">Entfernen</button>
            </div>
          ) : null}
          <label className="mt-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8] cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> {data.pdf_key ? "Neue Mappe hochladen" : "Mappe hochladen"}
            <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => uploadPdf(e.target.files?.[0])} data-testid="sponsoring-pdf-input" />
          </label>
        </div>

        <button type="button" onClick={save} disabled={busy} data-testid="sponsoring-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">Speichern</button>
      </div>
    </details>
  );
}
