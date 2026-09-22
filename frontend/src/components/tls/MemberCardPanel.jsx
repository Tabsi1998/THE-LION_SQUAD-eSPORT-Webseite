import { useCallback, useEffect, useRef, useState } from "react";
import { QrCode, RefreshCw, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/dolibarr";
import { refreshDelayMs, validUntilLine } from "@/lib/memberCard";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";

// Die Mitgliedskarte auf „Meine Mitgliedschaft“ (#346): Name, Nummer, Art, gültig bis und ein
// QR-Code mit dem Prüflink. Der Code erneuert sich vor Ablauf von selbst.

export function MemberCardPanel() {
  const [card, setCard] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get("/account/member-card");
      setCard(data);
    } catch {
      setError("Die Karte konnte gerade nicht geladen werden.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const delay = refreshDelayMs(card);
    if (delay === null) return undefined;
    timer.current = setTimeout(load, delay);
    return () => clearTimeout(timer.current);
  }, [card, load]);

  if (!card || card.status !== "valid") {
    if (error) return <div className="mt-6 border border-white/10 rounded-sm bg-[#121212] p-5 text-sm text-white/60" data-testid="member-card-error">{error}</div>;
    return null;
  }

  const accent = card.accent_color || "#FFD700";
  return (
    <div className="mt-6 border rounded-sm bg-[#0A0A0A] p-5 md:p-6" style={{ borderColor: accent }} data-testid="member-card">
      <div className="flex flex-col md:flex-row gap-6 md:items-center">
        <div className="shrink-0 self-center md:self-auto rounded-sm bg-white p-2">
          <BrandedQRCode value={card.verify_url} size={168} logoRatio={0.2} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: accent }}>{card.club_name} · Mitgliedskarte</span>
          <div className="mt-1 font-heading text-2xl font-black uppercase truncate">{card.name}</div>
          <div className="text-sm text-white/70">{card.type_label}</div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {card.member_number && <div><dt className="text-[10px] uppercase tracking-widest text-white/40">Nummer</dt><dd className="font-mono font-bold" style={{ color: accent }}>{card.member_number}</dd></div>}
            {card.member_since && <div><dt className="text-[10px] uppercase tracking-widest text-white/40">Seit</dt><dd className="font-bold">{formatDate(card.member_since)}</dd></div>}
          </dl>
          <div className="mt-3 text-sm text-white">{validUntilLine(card)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-white/50">
            <span className="inline-flex items-center gap-1.5"><QrCode className="w-3.5 h-3.5" /> Ein Partner scannt den Code und sieht nur: gültig, Vorname, Mitgliedsart.</span>
            <button type="button" onClick={load} data-testid="member-card-refresh" className="inline-flex items-center gap-1.5 text-[#FFD700] hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" /> Code erneuern
            </button>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/40"><Smartphone className="w-3.5 h-3.5" /> In der LionsAPP unter „Mehr → Mitgliederbereich → Mitgliedskarte“ immer dabei.</div>
        </div>
      </div>
    </div>
  );
}
