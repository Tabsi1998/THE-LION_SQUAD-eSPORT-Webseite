import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { motionAllowed, motionTransition } from "@/lib/motion";
import { loadResultImage, prefersShareSheet, shareResultImage } from "@/lib/resultShare";
import { bestResultText, comparisonText, countWord, fastlapText, seasonText, yearReviewPages } from "@/lib/yearReview";

// Jahresrückblick „Dein Jahr bei LION“ (#1195): Seiten zum Durchtippen wie eine Story - rechts tippen (oder Pfeil
// rechts) weiter, links zurück. Nur Seiten mit Inhalt; am Ende das Bild zum Teilen (Handy: Teilen-Menü, PC:
// herunterladen). Mit „Bewegung reduzieren“ wechseln die Seiten ohne Animation. Den Rückblick sieht nur man selbst.

function Big({ children, className = "" }) {
  return <div className={`font-heading font-black leading-none text-6xl md:text-7xl break-words ${className}`}>{children}</div>;
}

function Eyebrow({ children, tone = "gold" }) {
  return <div className={`text-[11px] font-bold uppercase tracking-[0.3em] ${tone === "gold" ? "text-[#FFD700]" : "text-[#29B6E8]"}`}>{children}</div>;
}

function Tile({ value, label }) {
  return (
    <div className="border border-white/10 bg-white/[0.04] rounded-sm px-3 py-2.5 min-w-0">
      <div className="font-heading font-black text-2xl text-[#29B6E8] tabular-nums">{value}</div>
      <div className="text-xs text-white/60 font-semibold leading-tight break-words">{label}</div>
    </div>
  );
}

function SharePage({ review }) {
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [mobile] = useState(() => prefersShareSheet());
  const fileName = `mein-jahr-${review.year}.png`;
  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    loadResultImage(resolveMediaUrl(`${review.image_path}${review.preview ? "?vorschau=true" : ""}`), fileName).then((loaded) => {
      if (!alive || !loaded) return;
      setFile(loaded);
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        objectUrl = URL.createObjectURL(loaded);
        setUrl(objectUrl);
      }
    });
    return () => {
      alive = false;
      if (objectUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
    };
  }, [review.image_path, review.preview, fileName]);
  const share = async () => {
    const result = await shareResultImage({ file, text: `Mein ${review.year} bei ${review.club_name}.`, title: `Mein ${review.year}` });
    if (result.status === "failed") toast.error("Teilen ging nicht – lade das Bild herunter.");
  };
  return (
    <div className="flex flex-col gap-4 h-full">
      <Eyebrow tone="cyan">Zum Teilen</Eyebrow>
      <div className="font-heading font-black uppercase text-2xl leading-tight">Dein Jahr als Bild</div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {url ? <img src={url} alt={`Mein ${review.year} – Zusammenfassung`} className="max-h-[46vh] w-auto rounded-sm border border-[#FFD700]/30" data-testid="year-review-card" />
          : <div className="text-xs text-white/40" data-testid="year-review-card-loading">Bild wird gezeichnet …</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {mobile ? (
          <button type="button" onClick={share} disabled={!file} className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-sm disabled:opacity-50" data-testid="year-review-share">
            <Share2 className="w-4 h-4" /> Bild teilen
          </button>
        ) : (
          <a href={url || undefined} download={fileName} aria-disabled={!url} className={`tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-sm ${url ? "" : "opacity-50 pointer-events-none"}`} data-testid="year-review-download">
            <Download className="w-4 h-4" /> Bild herunterladen
          </a>
        )}
        <Link to="/dashboard" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest rounded-sm" data-testid="year-review-done">Fertig</Link>
      </div>
    </div>
  );
}

function PageBody({ page, review }) {
  const t = review.tournaments || {};
  switch (page) {
    case "intro":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow>Dein Jahr bei {review.club_name}</Eyebrow>
          <Big className="text-[#FFD700]">{review.year}</Big>
          <p className="text-white/70 text-base">Turniere, Siege, Events und Bestzeiten – tipp dich durch dein Jahr. Rechts tippen für weiter.</p>
        </div>
      );
    case "tournaments":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow>Turniere</Eyebrow>
          <Big>{t.count}</Big>
          <div className="font-heading font-bold uppercase text-xl">{t.count === 1 ? "Turnier gespielt" : "Turniere gespielt"}</div>
          {comparisonText(review) ? <p className="text-white/60 text-sm" data-testid="year-review-comparison">{comparisonText(review)}</p> : null}
          <div className="grid grid-cols-3 gap-2">
            <Tile value={t.wins || 0} label={t.wins === 1 ? "Turniersieg" : "Turniersiege"} />
            <Tile value={t.podiums || 0} label="Podest" />
            <Tile value={t.games || 0} label="Spiele" />
          </div>
          {bestResultText(review) ? <p className="text-white/70 text-sm">{bestResultText(review)}</p> : null}
        </div>
      );
    case "favorite":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow>Lieblingsspiel</Eyebrow>
          <div className="font-heading font-black uppercase text-4xl md:text-5xl leading-tight break-words">{review.favorite_game.name}</div>
          <p className="text-white/70">{[countWord(review.favorite_game.tournaments, "Turnier", "Turniere"), review.favorite_game.games ? countWord(review.favorite_game.games, "Spiel", "Spiele") : null].filter(Boolean).join(" · ")}</p>
        </div>
      );
    case "events":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow>Events</Eyebrow>
          <Big>{review.events.count}</Big>
          <div className="font-heading font-bold uppercase text-xl">{review.events.count === 1 ? "Event besucht" : "Events besucht"}</div>
          <ul className="space-y-1.5">
            {(review.events.items || []).map((item) => (
              <li key={`${item.name}-${item.date}`} className="flex items-center justify-between gap-3 border-b border-white/10 pb-1.5 text-sm">
                <span className="truncate font-semibold">{item.name}</span><span className="shrink-0 text-white/50 tabular-nums">{item.date}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "fastlap":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow tone="cyan">Fast Lap</Eyebrow>
          <Big className="text-[#29B6E8] tabular-nums">{review.fastlap.best.time}</Big>
          <div className="font-heading font-bold uppercase text-xl">Deine Bestzeit</div>
          <p className="text-white/70 text-sm">{fastlapText(review)}</p>
          {review.fastlap.count > 1 ? <p className="text-white/50 text-sm">{countWord(review.fastlap.count, "Strecke", "Strecken")} gefahren</p> : null}
        </div>
      );
    case "achievements":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow>Erfolge</Eyebrow>
          <Big>{review.achievements.count}</Big>
          <div className="font-heading font-bold uppercase text-xl">{review.achievements.count === 1 ? "neuer Erfolg" : "neue Erfolge"}</div>
          <ul className="space-y-2">
            {(review.achievements.top || []).map((row) => (
              <li key={row.name} className="flex items-center gap-3 text-sm">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: row.material_color || "#FFD700" }} aria-hidden="true" />
                <span className="font-semibold truncate">{row.name}</span>
                {row.material_name ? <span className="text-white/45 text-xs shrink-0">{row.material_name}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      );
    case "season":
      return (
        <div className="flex flex-col gap-4">
          <Eyebrow>{review.season.name}</Eyebrow>
          <Big className="text-[#FFD700]">Platz {review.season.rank}</Big>
          <p className="text-white/70">{seasonText(review)}</p>
        </div>
      );
    default:
      return null;
  }
}

export default function YearReviewPage() {
  const [searchParams] = useSearchParams();
  const preview = searchParams.get("vorschau") === "1" || searchParams.get("vorschau") === "true";
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [state, setState] = useState("loading");
  const [index, setIndex] = useState(0);
  const [animate] = useState(() => motionAllowed());
  const frame = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get("/year-review/me", { params: preview ? { vorschau: true } : undefined })
      .then(({ data }) => { if (alive) { setReview(data); setState("ready"); } })
      .catch((err) => { if (alive) setState(err?.response?.status === 404 ? "none" : "error"); });
    return () => { alive = false; };
  }, [preview]);

  const pages = useMemo(() => yearReviewPages(review), [review]);
  const page = pages[index] || "intro";
  useDocumentTitle(review ? `Dein ${review.year}` : "Dein Jahr", "Dein Jahresrückblick – nur für dich.", { robots: "noindex, nofollow" });

  const go = useCallback((step) => setIndex((current) => Math.max(0, Math.min(pages.length - 1, current + step))), [pages.length]);
  useEffect(() => {
    const onKey = (event) => {
      // Wer gerade tippt (Suche, Felder), blättert nicht aus Versehen.
      const target = event.target;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Escape") navigate("/dashboard");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, navigate]);
  useEffect(() => { if (index > 0) frame.current?.focus?.({ preventScroll: true }); }, [index]);

  return (
    <PublicLayout>
      <div className="max-w-md mx-auto px-4 py-6 md:py-10">
        {state === "loading" && <div className="py-20 text-center font-display tracking-widest text-white/40" data-testid="year-review-loading">LADE DEIN JAHR …</div>}
        {(state === "none" || state === "error") && (
          <div className="border border-dashed border-white/15 rounded-sm px-6 py-14 text-center" data-testid="year-review-none">
            <h1 className="font-heading text-2xl font-bold uppercase text-white/80">{state === "none" ? "Gerade kein Jahresrückblick" : "Rückblick gerade nicht erreichbar"}</h1>
            <p className="mt-2 text-sm text-white/50">{state === "none" ? "Den Rückblick gibt es ab Mitte Dezember – für alle, die im Jahr gespielt, ein Event besucht oder eine Fast Lap gefahren haben." : "Bitte versuch es gleich noch einmal."}</p>
            <Link to="/dashboard" className="tls-btn tls-btn--secondary mt-6 inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm">Zum Dashboard</Link>
          </div>
        )}
        {state === "ready" && review && (
          <section
            ref={frame}
            tabIndex={-1}
            aria-roledescription="Rückblick"
            aria-label={`Seite ${index + 1} von ${pages.length}`}
            className="relative overflow-hidden rounded-sm border border-white/10 min-h-[560px] md:min-h-[620px] flex flex-col bg-[#08090B] outline-none"
            style={{ backgroundImage: "radial-gradient(120% 70% at 80% 0%, rgba(255,215,0,0.22), transparent 55%), radial-gradient(120% 70% at 0% 100%, rgba(41,182,232,0.22), transparent 55%)" }}
            data-testid="year-review"
            data-animate={animate ? "on" : "off"}
          >
            <div className="flex gap-1 px-3 pt-3" aria-hidden="true">
              {pages.map((key, i) => (
                <span key={key} className="h-[3px] flex-1 rounded-full bg-white/25 overflow-hidden">
                  <span className="block h-full bg-white origin-left" style={{ transform: `scaleX(${i <= index ? 1 : 0})`, transition: animate ? "transform var(--tls-motion-slow) var(--tls-ease)" : "none" }} data-testid={`year-review-bar-${i}`} />
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2.5 px-4 pt-3">
              <span className="w-8 h-8 rounded-full border border-white/20 bg-[#29B6E8]/20 flex items-center justify-center text-[11px] font-bold">{(review.user?.display_name || "?").slice(0, 2).toUpperCase()}</span>
              <span className="font-bold text-sm flex-1">Dein {review.year}{review.preview ? " · Vorschau" : ""}</span>
              <Link to="/dashboard" aria-label="Rückblick schließen" className="p-1.5 text-white/70 hover:text-white" data-testid="year-review-close"><X className="w-5 h-5" /></Link>
            </div>
            <div className="relative flex-1 px-6 pt-8 pb-6 select-none" data-testid="year-review-stage">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={page}
                  className="h-full"
                  initial={animate ? { opacity: 0, y: 14 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={animate ? { opacity: 0, y: -10 } : { opacity: 1 }}
                  transition={animate ? motionTransition("mid") : { duration: 0 }}
                  data-testid={`year-review-page-${page}`}
                >
                  {page === "share" ? <SharePage review={review} /> : <PageBody page={page} review={review} />}
                </motion.div>
              </AnimatePresence>
              {/* Tippen wie bei einer Story: linkes Drittel zurück, der Rest weiter. Die Seite zum Teilen hat eigene
                  Knöpfe - dort liegen keine Tippflächen darüber. Mit Tastatur: Pfeiltasten oder die Knöpfe unten. */}
              {page !== "share" ? (
                <>
                  <button type="button" tabIndex={-1} aria-label="Vorige Seite" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/3 bg-transparent cursor-pointer" data-testid="year-review-tap-prev" />
                  <button type="button" tabIndex={-1} aria-label="Nächste Seite" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-2/3 bg-transparent cursor-pointer" data-testid="year-review-tap-next" />
                </>
              ) : null}
            </div>
          </section>
        )}
        {state === "ready" && review && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <button type="button" onClick={() => go(-1)} disabled={index === 0} className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40" data-testid="year-review-prev">
              <ChevronLeft className="w-4 h-4" /> Zurück
            </button>
            <span className="text-xs text-white/45 tabular-nums" data-testid="year-review-position">{index + 1} / {pages.length}</span>
            <button type="button" onClick={() => go(1)} disabled={index >= pages.length - 1} className="tls-btn tls-btn--secondary inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40" data-testid="year-review-next">
              Weiter <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
