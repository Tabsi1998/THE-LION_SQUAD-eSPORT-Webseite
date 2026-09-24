// Einstellungen (#223): kleine Bausteine der Abschnitte (Hinweisleisten-Vorschau, Felder, SEO-Karte).
import { CheckCircle2, AlertTriangle, Activity } from "lucide-react";
import { BANNER_SCOPE_OPTIONS, bannerTickerDuration, toDateTimeInput, fromDateTimeInput } from "../shared";

export function BannerPreview({ banner }) {
  const text = banner.text || "Vorschau der Hinweisleiste";
  const repeated = `${text}  •  `.repeat(6);
  const isTicker = banner.mode === "ticker";
  const duration = bannerTickerDuration(text, banner.speed_seconds);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3 overflow-hidden">
      <div className="font-bold uppercase tracking-widest text-xs text-white/65">Vorschau</div>
      <div className={`tls-site-banner tls-site-banner--${banner.tone || "info"} tls-site-banner--${banner.style || "neon"} relative`}>
        <div className="tls-site-banner__inner">
          <Activity className="w-4 h-4 shrink-0" />
          <div className={`tls-site-banner__text ${isTicker ? "tls-site-banner__text--ticker" : ""}`}>
            {isTicker ? (
              <span className="tls-marquee-track" style={{ animationDuration: `${duration}s` }}>
                <span>{repeated}</span>
                <span aria-hidden="true">{repeated}</span>
              </span>
            ) : (
              <span>{text}</span>
            )}
          </div>
          {banner.link_label && <span className="tls-site-banner__link">{banner.link_label}</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-white/45">
        <div>Position: {banner.position}</div>
        <div>Bereich: {BANNER_SCOPE_OPTIONS.find(([key]) => key === banner.scope)?.[1] || banner.scope}</div>
        <div>Zielgruppe: {banner.audience}</div>
        <div>Laufzeit: {duration}s</div>
      </div>
    </div>
  );
}

export function BannerScopePicker({ value, onChange }) {
  const current = value || "all";
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bereich aktivieren</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="site-banner-scope">
        {BANNER_SCOPE_OPTIONS.map(([key, label]) => {
          const active = current === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              data-testid={`site-banner-scope-${key}`}
              className={`flex items-center gap-2 border px-3 py-2 rounded-sm text-left text-xs font-bold uppercase tracking-wider transition ${active ? "border-[#29B6E8]/65 bg-[#29B6E8]/12 text-[#29B6E8]" : "border-white/10 bg-[#0A0A0A] text-white/55 hover:border-white/25 hover:text-white"}`}
            >
              <span className={`w-4 h-4 border rounded-sm inline-flex items-center justify-center shrink-0 ${active ? "border-[#29B6E8] bg-[#29B6E8] text-black" : "border-white/20"}`}>
                {active && <CheckCircle2 className="w-3 h-3" />}
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BrandNumberField({ label, value, onChange, testId, min, max }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type="number" min={min} max={max} value={value || ""} onChange={(e) => onChange(Number(e.target.value || 0))} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

export function BrandDateTimeField({ label, value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type="datetime-local" value={toDateTimeInput(value)} onChange={(e) => onChange(fromDateTimeInput(e.target.value))} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

export function SeoStatusCard({ title, ok, detail }) {
  return (
    <div className={`rounded-sm border bg-[#121212] p-3 ${ok ? "border-[#10B981]/25" : "border-[#FFD700]/25"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/65">{title}</div>
        {ok ? <CheckCircle2 className="h-4 w-4 text-[#10B981]" /> : <AlertTriangle className="h-4 w-4 text-[#FFD700]" />}
      </div>
      <div className="mt-2 break-words text-xs leading-relaxed text-white/45">{detail}</div>
    </div>
  );
}
