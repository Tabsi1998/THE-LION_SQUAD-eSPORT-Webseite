import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, ShieldAlert, ShieldCheck } from "lucide-react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { formatMoment } from "@/components/tls/ModerationStandingCard";

// Bildprüfung (#415): Stand des Anbieters, Schwellen und Schalter, die Warteschlange mit Vorschau
// (nur hier sichtbar) und die Umkehr jeder Entscheidung durch einen Menschen.

const PROVIDERS = [
  ["local", "Selbst gehostet (NudeNet) – kein Bild verlässt den Server"],
  ["google_vision", "Google Cloud Vision (SafeSearch) – Bilder gehen an Google"],
  ["off", "Aus – keine Prüfung"],
];
const STATE_LABEL = { pending: "wartet", safe: "unauffällig", review: "Prüfung nötig", blocked: "entfernt", failed: "Anbieter-Fehler (sichtbar)" };
const STATE_TONE = { pending: "text-white/50", safe: "text-[#00FF88]", review: "text-[#FFD700]", blocked: "text-[#FF3B30]", failed: "text-[#FF6B6B]" };
const FILTERS = [["review", "Prüfung nötig"], ["blocked", "Entfernt"], ["failed", "Fehler"], ["safe", "Unauffällig"], ["all", "Alle"]];

export function percent(value) {
  return Math.round((Number(value) || 0) * 100);
}

export function settingsPayload(form) {
  return {
    provider: form.provider,
    review_threshold: Math.min(1, Math.max(0, (Number(form.review_percent) || 0) / 100)),
    block_threshold: Math.min(1, Math.max(0, (Number(form.block_percent) || 0) / 100)),
    strike_on_block: Boolean(form.strike_on_block),
    retention_days: Number(form.retention_days) || 90,
    ...(form.google_api_key ? { google_api_key: form.google_api_key } : {}),
  };
}

function formFromSettings(settings) {
  return {
    provider: settings.provider,
    review_percent: percent(settings.review_threshold),
    block_percent: percent(settings.block_threshold),
    strike_on_block: settings.strike_on_block !== false,
    retention_days: settings.retention_days || 90,
    google_api_key: "",
    google_api_key_masked: Boolean(settings.google_api_key_masked),
  };
}

export default function ImageScanTab() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("review");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState({});

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get("/moderation/media-scan/status");
      setStatus(data);
      setForm((current) => current || formFromSettings(data.settings || {}));
    } catch (error) {
      toast.error(formatRequestError(error, "Der Stand der Bildprüfung konnte nicht geladen werden."));
    }
  }, []);
  const loadQueue = useCallback(async (state) => {
    try {
      const { data } = await api.get(`/moderation/media-scan/queue?state=${state}&limit=100`);
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(formatRequestError(error, "Die Warteschlange konnte nicht geladen werden."));
    }
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadQueue(filter); }, [filter, loadQueue]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const { data } = await api.put("/moderation/media-scan/settings", settingsPayload(form));
      setForm(formFromSettings(data));
      toast.success("Bildprüfung gespeichert.");
      await loadStatus();
    } catch (error) {
      toast.error(formatRequestError(error, "Speichern hat nicht geklappt."));
    } finally {
      setSaving(false);
    }
  };
  const clearKey = async () => {
    try {
      const { data } = await api.put("/moderation/media-scan/settings", { clear_google_api_key: true });
      setForm(formFromSettings(data));
      toast.success("Schlüssel entfernt.");
      await loadStatus();
    } catch (error) {
      toast.error(formatRequestError(error, "Entfernen hat nicht geklappt."));
    }
  };
  const decide = async (row, action) => {
    setBusy(`${row.id}:${action}`);
    try {
      await api.post(`/moderation/media-scan/${row.id}/${action}`, { note: notes[row.id] || "" });
      toast.success(action === "approve" ? "Freigegeben." : "Entfernt.");
      setNotes((current) => ({ ...current, [row.id]: "" }));
      await Promise.all([loadQueue(filter), loadStatus()]);
    } catch (error) {
      toast.error(formatRequestError(error, "Das hat nicht geklappt."));
    } finally {
      setBusy("");
    }
  };

  const counts = status?.counts_30d || {};
  return (
    <div className="space-y-6" data-testid="image-scan-tab">
      {status && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="image-scan-status">
          <StatCard title="Anbieter" ok={status.health?.ok} detail={status.health?.label || "–"} problem={status.health?.ok ? "" : status.health?.detail} testId="image-scan-provider" />
          <StatCard title="Wartet" ok={!status.pending} detail={`${status.pending || 0} in der Warteschlange`} />
          <StatCard title="Prüfung nötig" ok={!status.review_open} detail={`${status.review_open || 0} offen`} testId="image-scan-review-open" />
          <StatCard title="Letzte 30 Tage" ok detail={`${counts.safe || 0} unauffällig · ${counts.review || 0} geprüft · ${counts.blocked || 0} entfernt · ${counts.failed || 0} Fehler`} />
        </div>
      )}

      {form && (
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="image-scan-settings">
          <div>
            <div className="font-heading font-bold uppercase">Anbieter und Schwellen</div>
            <p className="mt-1 text-xs text-white/50">
              Geprüft wird jedes hochgeladene Bild (Chat, Profil, Team). Es zählt der höhere Wert aus Nacktheit und Gewalt: ab „Prüfung nötig“ bleibt ein Chat-Bild verborgen, bis ihr entscheidet;
              ab „Entfernen“ geht es sofort in die Quarantäne, die Person bekommt eine Nachricht und – wenn eingeschaltet – einen Treffer für die Stufen. Die Maschine entscheidet nie endgültig: jede Entscheidung lässt sich unten umdrehen.
            </p>
          </div>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Anbieter</div>
            <select value={form.provider} onChange={(e) => set("provider", e.target.value)} data-testid="image-scan-provider-select" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {PROVIDERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          {form.provider === "google_vision" && (
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Google Cloud Vision API-Schlüssel {form.google_api_key_masked && <span className="text-white/40 normal-case">(aktuell gespeichert)</span>}</div>
              <input type="password" value={form.google_api_key} onChange={(e) => set("google_api_key", e.target.value)} data-testid="image-scan-google-key" autoComplete="off" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder={form.google_api_key_masked ? "Leer lassen, um den Schlüssel zu behalten" : "API-Schlüssel aus der Google Cloud Console (Vision API)"} />
              <p className="mt-1 text-xs text-white/40">Bilder gehen dann an Google – das steht automatisch in der Datenschutzerklärung.</p>
              {form.google_api_key_masked && <button type="button" onClick={clearKey} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeicherten Schlüssel entfernen</button>}
            </label>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            <NumberField label="Prüfung nötig ab (%)" value={form.review_percent} onChange={(v) => set("review_percent", v)} testId="image-scan-review" min={0} max={100} />
            <NumberField label="Entfernen ab (%)" value={form.block_percent} onChange={(v) => set("block_percent", v)} testId="image-scan-block" min={0} max={100} />
            <NumberField label="Aufbewahrung entfernter Originale (Tage)" value={form.retention_days} onChange={(v) => set("retention_days", v)} testId="image-scan-retention" min={1} max={3650} />
          </div>
          <label className="flex items-start gap-2 text-sm text-white/75">
            <input type="checkbox" checked={form.strike_on_block} onChange={(e) => set("strike_on_block", e.target.checked)} data-testid="image-scan-strike" className="mt-1 accent-[#29B6E8]" />
            <span>Ein entferntes Bild zählt als Treffer für die Verwarnungsstufen (Personen → Historie).</span>
          </label>
          <button type="button" onClick={save} disabled={saving} data-testid="image-scan-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="font-heading font-bold uppercase mr-2">Warteschlange</div>
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} data-testid={`image-scan-filter-${key}`} className={`px-3 py-1.5 border rounded-sm text-[10px] font-bold uppercase tracking-wider transition ${filter === key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/60 hover:text-white"}`}>{label}</button>
          ))}
        </div>
        <div className="grid gap-3" data-testid="image-scan-queue">
          {rows.map((row) => (
            <ScanRow key={row.id} row={row} note={notes[row.id] || ""} onNote={(value) => setNotes((current) => ({ ...current, [row.id]: value }))} onDecide={(action) => decide(row, action)} busy={busy} />
          ))}
          {!rows.length && (
            <div className="border border-dashed border-white/15 rounded-sm px-4 py-10 text-center text-sm text-white/40" data-testid="image-scan-empty">
              {filter === "review" ? "Nichts wartet auf eine Entscheidung." : "Keine Einträge."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, ok, detail, problem = "", testId }) {
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <div className={`border rounded-sm p-3 ${ok ? "border-[#00FF88]/25 bg-[#00FF88]/5" : "border-[#FF3B30]/30 bg-[#FF3B30]/5"}`} data-testid={testId}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/50"><Icon className={`w-3.5 h-3.5 ${ok ? "text-[#00FF88]" : "text-[#FF3B30]"}`} /> {title}</div>
      <div className="mt-1 text-sm text-white/85">{detail}</div>
      {problem && <div className="mt-1 text-xs text-[#FF6B6B]">{problem}</div>}
    </div>
  );
}

function NumberField({ label, value, onChange, testId, min, max }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type="number" min={min} max={max} value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function ScanRow({ row, note, onNote, onDecide, busy }) {
  const scores = row.scores || {};
  const owner = row.owner ? (row.owner.display_name || row.owner.username) : "unbekannt";
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-3 grid md:grid-cols-[11rem_minmax(0,1fr)] gap-3" data-testid={`image-scan-row-${row.id}`}>
      <div className="h-40 md:h-36 bg-[#0A0A0A] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center">
        {row.preview_url ? (
          <img src={resolveMediaUrl(row.preview_url)} alt="" className="w-full h-full object-contain" data-testid={`image-scan-preview-${row.id}`} />
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-white/35 px-2 text-center">kein Bild mehr vorhanden</span>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={`font-bold uppercase tracking-wider ${STATE_TONE[row.state] || "text-white/60"}`} data-testid={`image-scan-state-${row.id}`}>{STATE_LABEL[row.state] || row.state}</span>
          <span className="text-white/70">{row.kind_label}{row.context_label ? ` · ${row.context_label}` : ""}</span>
          <span className="text-white/50">von <span className="text-white/80">{owner}</span>{row.owner?.username ? ` (@${row.owner.username})` : ""}</span>
          <span className="text-white/40">{formatMoment(row.created_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="px-2 py-0.5 border border-white/10 rounded-sm text-white/70">Nacktheit {percent(scores.nudity)} %</span>
          <span className="px-2 py-0.5 border border-white/10 rounded-sm text-white/70">Gewalt {percent(scores.violence)} %</span>
          {scores.racy > 0 && <span className="px-2 py-0.5 border border-white/10 rounded-sm text-white/50">anzüglich {percent(scores.racy)} %</span>}
          <span className="px-2 py-0.5 border border-white/10 rounded-sm text-white/40">{row.provider_label}</span>
        </div>
        {row.error && <div className="text-xs text-[#FF6B6B]">Fehler: {row.error}</div>}
        {row.note && <div className="text-xs text-white/60">Notiz: {row.note}</div>}
        {row.decided_by && row.decided_by !== "system" && <div className="text-[11px] text-white/40">Entschieden von der Moderation {formatMoment(row.decided_at)}</div>}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <input value={note} onChange={(e) => onNote(e.target.value)} data-testid={`image-scan-note-${row.id}`} placeholder="Grund (optional)" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          {row.state !== "safe" && (
            <button type="button" onClick={() => onDecide("approve")} disabled={Boolean(busy)} data-testid={`image-scan-approve-${row.id}`} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-[#00FF88]/50 text-[#00FF88] rounded-sm text-[10px] font-bold uppercase tracking-wider hover:bg-[#00FF88]/10 disabled:opacity-50"><Eye className="w-3.5 h-3.5" /> Freigeben</button>
          )}
          {row.state !== "blocked" && (
            <button type="button" onClick={() => onDecide("remove")} disabled={Boolean(busy)} data-testid={`image-scan-remove-${row.id}`} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-[#FF3B30]/50 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase tracking-wider hover:bg-[#FF3B30]/10 disabled:opacity-50"><ShieldAlert className="w-3.5 h-3.5" /> Entfernen</button>
          )}
        </div>
      </div>
    </div>
  );
}
