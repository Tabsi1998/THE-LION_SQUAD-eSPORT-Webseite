import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Lock, Trophy } from "lucide-react";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { ResultShareButton } from "@/components/tls/ResultShareButton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { resultFileName } from "@/lib/resultShare";

// Die Teilen-Seite eines Turnier-Ergebnisses (#1194): /tournaments/<turnier>/ergebnis/<name>. Zeigt das hohe Bild
// (Status, Story), Platz, Turnier, Datum und den Weg - Discord, WhatsApp & Co. bekommen das breite Bild als
// Vorschau. Nur, wenn Profil und Turnier öffentlich sind; sonst „nicht öffentlich“.

const OUTCOME_STYLE = {
  win: { mark: "bg-[#29B6E8]", value: "text-[#29B6E8]", word: "Sieg" },
  loss: { mark: "bg-white/25", value: "text-white/50", word: "Niederlage" },
  draw: { mark: "bg-white/70", value: "text-white", word: "Unentschieden" },
  placed: { mark: "bg-white/70", value: "text-white", word: "" },
};

export function PathList({ steps = [], title = "Weg", testId = "result-path" }) {
  if (!steps.length) return null;
  return (
    <div data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/45">{title}</div>
      <ol className="mt-2 space-y-1.5">
        {steps.map((step, index) => {
          const style = OUTCOME_STYLE[step.outcome] || OUTCOME_STYLE.placed;
          return (
            <li key={`${step.label}-${index}`} className="flex items-center gap-3 border border-white/10 bg-white/[0.03] rounded-sm pl-2 pr-3 py-2" data-testid={`${testId}-step`}>
              <span className={`w-1 self-stretch rounded-full ${style.mark}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-semibold text-sm">{step.label}</span>
              {style.word ? <span className="sr-only">{style.word}</span> : null}
              <span className={`shrink-0 font-heading font-bold tabular-nums text-sm ${style.value}`}>{step.result}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ResultSharePage() {
  const { slug, username } = useParams();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    api.get(`/share/result/${encodeURIComponent(slug)}/${encodeURIComponent(username)}`)
      .then(({ data: payload }) => { if (alive) { setData(payload); setState("ready"); } })
      .catch((err) => { if (alive) setState(err?.response?.status === 404 ? "private" : "error"); });
    return () => { alive = false; };
  }, [slug, username]);

  const story = data ? resolveMediaUrl(data.image_paths.story) : "";
  const wide = data ? resolveMediaUrl(data.image_paths.wide) : "";
  const person = data ? (data.team_name || data.user?.display_name || "Spieler") : "";
  useDocumentTitle(
    data ? `${data.headline} · ${person}` : "Ergebnis",
    data ? data.share_text : "Ein geteiltes Turnier-Ergebnis.",
    data ? { image: wide, type: "article", robots: "noindex, follow", canonical: `${window.location.origin}${data.path}` } : { robots: "noindex, follow" },
  );

  const rankColor = data?.rank === 1 ? "text-[#FFD700]" : data?.rank === 2 ? "text-[#D9DEE5]" : data?.rank === 3 ? "text-[#E0A06A]" : "text-white";
  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-14">
        <Link to={`/tournaments/${encodeURIComponent(data?.tournament?.slug || slug)}`} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white" data-testid="result-share-back">
          <ArrowLeft className="w-3 h-3" /> Zum Turnier
        </Link>

        {state === "loading" && <div className="py-20 text-center font-display tracking-widest text-white/40" data-testid="result-share-loading">LADE ERGEBNIS …</div>}

        {(state === "private" || state === "error") && (
          <div className="mt-6 border border-dashed border-white/15 rounded-sm px-6 py-16 text-center" data-testid="result-share-private">
            <Lock className="w-8 h-8 mx-auto mb-3 text-white/25" />
            <h1 className="font-heading text-2xl font-bold uppercase text-white/80">{state === "private" ? "Dieses Ergebnis ist nicht öffentlich" : "Ergebnis gerade nicht erreichbar"}</h1>
            <p className="mt-2 text-sm text-white/45 max-w-md mx-auto">
              {state === "private"
                ? "Entweder gibt es das Ergebnis nicht, das Turnier ist nicht öffentlich oder die Person zeigt ihr Profil nicht öffentlich."
                : "Bitte versuch es gleich noch einmal."}
            </p>
            <Link to="/tournaments" className="tls-btn tls-btn--secondary mt-6 inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm">
              <Trophy className="w-3.5 h-3.5" /> Zu den Turnieren
            </Link>
          </div>
        )}

        {state === "ready" && data && (
          <motion.article
            className="mt-6 grid gap-6 md:gap-10 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] items-start"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            data-testid="result-share-card"
          >
            <img src={story} alt={`${data.headline} – ${person}`} width={1080} height={1920}
              className="w-full max-w-[320px] mx-auto md:mx-0 h-auto block rounded-sm border border-[#29B6E8]/30 bg-[#0A0A0A] shadow-[0_0_48px_rgba(41,182,232,0.12)]" data-testid="result-share-image" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#29B6E8]">
                {[data.event_name, data.date].filter(Boolean).join(" · ") || data.club_name}
              </div>
              <div className="mt-2 flex items-end gap-4">
                <span className={`font-heading font-black leading-none text-6xl md:text-7xl tabular-nums ${rankColor}`} data-testid="result-share-rank">{data.rank ? `${data.rank}.` : "–"}</span>
                {data.participant_count ? <span className="pb-1 text-xs font-bold uppercase tracking-widest text-white/45">von {data.participant_count} {data.participant_word}</span> : null}
              </div>
              <h1 className="mt-3 font-heading text-2xl md:text-4xl font-black uppercase leading-tight break-words" data-testid="result-share-headline">{data.headline}</h1>
              <Link to={`/u/${encodeURIComponent(data.user.username)}`} className="mt-3 inline-flex items-center gap-2 text-sm hover:text-[#29B6E8]" data-testid="result-share-person">
                <span className="w-7 h-7 rounded-sm border border-white/15 bg-white/5 flex items-center justify-center font-bold text-white/60 text-xs">{person.trim().charAt(0).toUpperCase()}</span>
                <span className="font-semibold">{person}</span>
                {data.team_name ? <span className="text-white/40 text-xs">geteilt von {data.user.display_name}</span> : null}
              </Link>
              <div className="mt-6">
                <PathList steps={data.steps} title={data.team_name ? "Weg des Teams" : "Weg durchs Turnier"} />
              </div>
              <div className="mt-6 space-y-3">
                <ResultShareButton options={{ shareable: true, path: data.path, image_paths: data.image_paths, headline: data.headline, share_text: data.share_text }} showPage={false} testId="result-share-actions" />
                <a href={wide} download={resultFileName(data.path, "wide")} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/55 hover:text-white" data-testid="result-share-wide">
                  <Download className="w-3.5 h-3.5" /> Breites Bild (1200 × 630)
                </a>
              </div>
            </div>
          </motion.article>
        )}
      </div>
    </PublicLayout>
  );
}
