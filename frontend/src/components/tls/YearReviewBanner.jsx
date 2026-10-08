import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { YEAR_REVIEW_PATH } from "@/lib/yearReview";

// Jahresrückblick (#1195) auf dem Dashboard: ab Mitte Dezember „Dein Jahr 2026 ist da“ - nur, wenn es für dich einen
// Rückblick gibt (gespielt, Event besucht oder Fast Lap gefahren). Sonst steht hier nichts.
export function YearReviewBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get("/year-review/status")
      .then(({ data }) => { if (alive) setStatus(data); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, []);
  if (!status?.available) return null;
  return (
    <section
      className="mb-8 border border-[#FFD700]/40 rounded-sm p-5 flex flex-wrap items-center gap-4 bg-[#08090B]"
      style={{ backgroundImage: "radial-gradient(120% 140% at 100% 0%, rgba(255,215,0,0.18), transparent 60%), radial-gradient(120% 140% at 0% 100%, rgba(41,182,232,0.14), transparent 60%)" }}
      data-testid="year-review-banner"
    >
      <span className="w-11 h-11 rounded-sm border border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700] inline-flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
      <div className="flex-1 min-w-[180px]">
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Jahresrückblick</div>
        <h2 className="font-heading text-lg md:text-xl font-bold uppercase mt-0.5">Dein Jahr {status.year} ist da</h2>
        <p className="text-xs text-white/55 mt-1">Turniere, Siege, Events und Bestzeiten zum Durchtippen – nur für dich.</p>
      </div>
      <Link to={status.path || YEAR_REVIEW_PATH} className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-sm" data-testid="year-review-banner-open">
        Ansehen
      </Link>
    </section>
  );
}

export default YearReviewBanner;
