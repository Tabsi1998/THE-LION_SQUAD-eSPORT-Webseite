import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { stickerSrc } from "@/lib/stickers";
import { useFooterLineTop } from "../footerLine";
import { previewTokenFor } from "../preview";
import { markToastShown, toastShownToday } from "../SeasonStage";
import { BOOT_COLORS as C, BOOT_PATHS as P, BOOT_SIZE, BOOT_VIEWBOX, CARD_MS, FUR, FUR_BAND, OPEN_MS, TREATS, USED_TILT, bootFit, cardFor, leafPath } from "./boot";
import "./nikolaus.css";

// Nikolaus (Jahreszeiten II S8, X3 #736): am 6. Dezember steht ein Stiefel auf der Linie über dem Impressum - kein
// schwebendes Symbol, sondern eine kleine Szene an einer echten Kante. Ein Klick: der Stiefel wackelt, der Gutschein
// steigt heraus, darüber erscheint die Karte mit dem Sticker, den der Nikolaus dieser Person bringt (einer je Person und
// Jahr, der Server entscheidet). Danach steht der Stiefel ruhig und leicht gekippt da, ohne Gutschein. Ohne Anmeldung
// sagt die Karte, dass Angemeldete einen Sticker finden. Weil kaum jemand bis zum Footer scrollt, kommt einmal am Tag
// ein Hinweis mit „Zum Stiefel“, und seit #852 steht ein kleiner Stiefel im Kopf gleich neben Kranz und Kalender (am
// Handy ganz oben im Menü): ein Klick führt hinunter und öffnet ihn. „dezent“ und „Bewegung reduzieren“: kein Wackeln,
// die Karte steht gleich da.

export const HINT_DELAY_MS = 1800;
export const HINT_MS = 12000;
export const BOOT_ID = "tls-nikolaus-boot";
/** Was über der Linie Platz wegnimmt: Schrift, Bilder, Bedienung im Footer. */
const FOOTER_BLOCKERS = "a, button, img, svg, input, select, textarea, p, span, li, h1, h2, h3, h4, h5, h6";
const HINT_KEY = "nikolaus-hint";

/** Der Zustand des Stiefels für die angemeldete Person - Footer und Hinweis fragen einmal gemeinsam. */
let pendingState = null;
let pendingUser = null;
let pendingPreview = null;

export function loadBootState(userId, get = (url, config) => api.get(url, config)) {
  // In der Vorschau (Admin) fragt der Stiefel mit dem Token: dann steht er geschlossen da und lässt sich probehalber öffnen.
  const preview = previewTokenFor("nikolaus");
  if (!userId) return Promise.resolve(null);
  if (pendingUser !== userId || pendingPreview !== preview || !pendingState) {
    pendingUser = userId;
    pendingPreview = preview;
    pendingState = get("/seasonal/nikolaus", preview ? { params: { preview } } : undefined).then(({ data }) => data || null).catch(() => null);
  }
  return pendingState;
}

/** Nur für Tests: den gemeinsamen Abruf vergessen. */
export function resetBootState() {
  pendingState = null;
  pendingUser = null;
  pendingPreview = null;
}

/**
 * Platz und Größe des Stiefels aus der Seite: die Linie und alles darüber im Footer (ohne den Stiefel selbst) -
 * neu gemessen, wenn sich die Linie oder die Fensterbreite ändert.
 */
export function useBootFit(lineTop) {
  const [fit, setFit] = useState(() => bootFit({ line: null }));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const measure = () => {
      const footer = document.querySelector("footer");
      const line = footer?.querySelector("[data-season-line]");
      const blockers = footer ? [...footer.querySelectorAll(FOOTER_BLOCKERS)].filter((node) => !node.closest(".tls-nikolaus-scene")).map((node) => node.getBoundingClientRect()) : [];
      setFit(bootFit({ line: line ? line.getBoundingClientRect() : null, blockers, viewportWidth: window.innerWidth }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [lineTop]);
  return fit;
}

/** Der Stiefel als Bild: Inhalt hinter dem Fellrand, Filz mit Verlauf, Naht, Sohle, Glanz; `used` gekippt ohne Gutschein. */
export function BootArt({ used = false, height = BOOT_SIZE.height }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tangerine = used ? TREATS.tangerine.used : TREATS.tangerine.full;
  const { chocolate, voucher, nut } = TREATS;
  const body = (
    <>
      <g transform={`rotate(${chocolate.rotate} ${chocolate.cx} ${chocolate.cy})`}>
        <rect x={chocolate.x} y={chocolate.y} width={chocolate.width} height={chocolate.height} rx={chocolate.rx} fill={C.chocolate} />
        <rect x={chocolate.x} y={chocolate.wrapperY} width={chocolate.width} height={chocolate.wrapperHeight} rx="1" fill={C.wrapper} />
        <path d={P.chocolateLines} stroke={C.chocolateLine} strokeWidth="0.7" />
      </g>
      {!used && (
        // Eine eigene Hülle: das Steigen beim Öffnen (CSS) überschreibt sonst die Drehung des Gutscheins.
        <g className="tls-nikolaus-voucher" data-testid="nikolaus-voucher">
          <g transform={`rotate(${voucher.rotate} ${voucher.cx} ${voucher.cy})`}>
            <rect x={voucher.x} y={voucher.y} width={voucher.width} height={voucher.height} rx={voucher.rx} fill={C.voucher} stroke={C.voucherEdge} strokeWidth="0.6" />
            <path d={P.star} fill={C.star} />
          </g>
        </g>
      )}
      <circle cx={tangerine.cx} cy={tangerine.cy} r={TREATS.tangerine.r} fill={`url(#${ids}-tangerine)`} />
      <path d={leafPath(tangerine)} fill={C.leaf} />
      <ellipse cx={nut.cx} cy={nut.cy} rx={nut.rx} ry={nut.ry} fill={C.nut} />
      <path d={P.nutLine} stroke={C.nutLine} strokeWidth="0.6" fill="none" />
      <path d={P.shaft} fill={`url(#${ids}-felt)`} />
      <path d={P.shaft} fill={`url(#${ids}-shade)`} />
      <path d={P.seam} stroke={C.seam} strokeWidth="0.7" strokeDasharray="1.6 1.4" opacity="0.8" />
      <path d={P.sole} fill={C.sole} />
      <path d={P.shine} stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.22" fill="none" />
      <rect x={FUR_BAND.x} y={FUR_BAND.y} width={FUR_BAND.width} height={FUR_BAND.height} rx={FUR_BAND.rx} fill={C.furBase} />
      {FUR.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={C.fur} />)}
      <path d={P.furShadow} stroke={C.furShadow} strokeWidth="0.8" fill="none" opacity="0.9" />
    </>
  );
  return (
    <svg className="tls-nikolaus-art" width={Math.round((height * BOOT_SIZE.width) / BOOT_SIZE.height)} height={height} viewBox={`${BOOT_VIEWBOX.x} ${BOOT_VIEWBOX.y} ${BOOT_VIEWBOX.width} ${BOOT_VIEWBOX.height}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${ids}-felt`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={C.feltDark} />
          <stop offset="0.55" stopColor={C.felt} />
          <stop offset="1" stopColor={C.feltSide} />
        </linearGradient>
        <linearGradient id={`${ids}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.62" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id={`${ids}-tangerine`} cx="0.38" cy="0.35" r="0.7">
          <stop offset="0" stopColor={C.tangerineLight} />
          <stop offset="0.7" stopColor={C.tangerine} />
          <stop offset="1" stopColor={C.tangerineDark} />
        </radialGradient>
      </defs>
      {used ? <g transform={`rotate(${USED_TILT.angle} ${USED_TILT.cx} ${USED_TILT.cy})`}>{body}</g> : body}
    </svg>
  );
}

/** Die Karte über dem Stiefel: Sticker, Gruß, wo man ihn findet - ohne Anmeldung der Weg zum Login. */
function BootCard({ card, onClose }) {
  return (
    <div className={`tls-nikolaus-card tls-nikolaus-card--${card.kind}`} role="status" data-testid="nikolaus-card" data-kind={card.kind}>
      {card.sticker && <img className="tls-nikolaus-card__sticker" src={stickerSrc(card.sticker.url)} alt={card.sticker.name} width="64" height="64" data-testid="nikolaus-card-sticker" />}
      <div className="tls-nikolaus-card__body">
        <div className="tls-nikolaus-card__title">{card.title}</div>
        {card.sticker && <div className="tls-nikolaus-card__name">{card.sticker.name}</div>}
        <p className="tls-nikolaus-card__text">{card.text}</p>
        {card.kind === "guest" && <Link to="/login" className="tls-nikolaus-card__link" data-testid="nikolaus-card-login">Anmelden</Link>}
      </div>
      <button type="button" className="tls-nikolaus-card__close" aria-label="Karte schließen" onClick={onClose} data-testid="nikolaus-card-close">×</button>
    </div>
  );
}

/**
 * Der Stiefel auf der Linie über dem Impressum. Angemeldet fragt er den Server, ob er heuer schon geöffnet wurde (dann
 * steht er benutzt da); ein Klick öffnet ihn. Wackeln und Steigen dauern OPEN_MS - die Antwort des Servers läuft
 * parallel, die Karte kommt, wenn beides fertig ist.
 */
export function Footer({ season }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const lineTop = useFooterLineTop([]);
  const fit = useBootFit(lineTop);
  const still = season.effective === "subtle";
  const greeting = season.texts?.greeting || "";
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [card, setCard] = useState(null);
  const timers = useRef([]);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setOpened(false);
    loadBootState(userId).then((state) => {
      if (!cancelled && state?.active) setOpened(Boolean(state.opened));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => () => timers.current.forEach((handle) => window.clearTimeout(handle)), []);

  const close = () => {
    timers.current.forEach((handle) => window.clearTimeout(handle));
    timers.current = [];
    setCard(null);
    setPhase("idle");
  };

  const open = async () => {
    if (busy.current) return;
    busy.current = true;
    close();
    const started = Date.now();
    if (!still) setPhase("opening");
    let next;
    if (!userId) {
      next = cardFor({ reason: "guest", greeting });
    } else {
      try {
        const preview = previewTokenFor("nikolaus");
        const { data } = await api.post("/seasonal/nikolaus/open", null, preview ? { params: { preview } } : undefined);
        next = cardFor({ result: data, greeting });
        // Die Vorschau verschenkt nichts - der Stiefel bleibt zu und lässt sich wieder öffnen.
        if (!data?.preview) setOpened(true);
      } catch (error) {
        next = cardFor({ reason: error?.response?.status === 409 ? "closed" : "error", greeting });
      }
    }
    const wait = still ? 0 : Math.max(0, OPEN_MS - (Date.now() - started));
    timers.current.push(window.setTimeout(() => {
      busy.current = false;
      setCard(next);
      setPhase("card");
    }, wait));
    timers.current.push(window.setTimeout(close, wait + CARD_MS));
  };

  const used = opened && phase !== "opening";
  return (
    <div className="tls-nikolaus-scene" style={{ right: `${fit.right}px`, ...(lineTop === null ? {} : { top: `${lineTop}px` }) }} data-testid="nikolaus-scene" data-line={lineTop === null ? undefined : "1"} data-height={fit.height}>
      {card && <BootCard card={card} onClose={close} />}
      <button
        type="button"
        id={BOOT_ID}
        className={`tls-nikolaus-boot${phase === "opening" ? " tls-nikolaus-boot--opening" : ""}${used ? " tls-nikolaus-boot--used" : ""}${still ? " tls-nikolaus-boot--still" : ""}`}
        aria-label={used ? "Nikolausstiefel – schon geöffnet, noch einmal ansehen" : "Nikolausstiefel öffnen"}
        title="Nikolausstiefel"
        onClick={open}
        data-testid="nikolaus-boot"
        data-used={used ? "1" : undefined}
      >
        <BootArt used={used} height={fit.height} />
      </button>
    </div>
  );
}

/**
 * Der Hinweis (einmal am Tag): „Der Nikolaus war da“ mit dem Weg zum Stiefel - nicht für wen, der ihn heuer schon
 * geöffnet hat. „Zum Stiefel“ scrollt hin und gibt ihm den Fokus.
 */
export function Toast({ season, now = null }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (toastShownToday(HINT_KEY, now || new Date())) return undefined;
    let cancelled = false;
    const timers = [];
    loadBootState(userId).then((state) => {
      if (cancelled || state?.opened) return;
      timers.push(window.setTimeout(() => {
        markToastShown(HINT_KEY, now || new Date());
        setOpen(true);
      }, HINT_DELAY_MS));
      timers.push(window.setTimeout(() => setOpen(false), HINT_DELAY_MS + HINT_MS));
    });
    return () => {
      cancelled = true;
      timers.forEach((handle) => window.clearTimeout(handle));
    };
  }, [userId, now]);
  if (!open) return null;
  const toBoot = () => {
    setOpen(false);
    const boot = typeof document === "undefined" ? null : document.getElementById(BOOT_ID);
    if (!boot) return;
    boot.scrollIntoView?.({ behavior: season.effective === "subtle" ? "auto" : "smooth", block: "center" });
    boot.focus?.({ preventScroll: true });
  };
  return (
    <div className="tls-season-toast tls-nikolaus-hint" role="status" data-testid="nikolaus-hint">
      <BootArt />
      <div className="tls-nikolaus-hint__body">
        <div className="tls-nikolaus-hint__title">{season.texts?.greeting || "Der Nikolaus war da"}</div>
        <p className="tls-nikolaus-hint__text">{userId ? "Unten auf der Seite steht dein Stiefel – schau hinein!" : "Unten auf der Seite steht ein Stiefel. Wer angemeldet ist, findet darin einen Sticker."}</p>
        <div className="tls-nikolaus-hint__actions">
          <button type="button" className="tls-nikolaus-hint__button" onClick={toBoot} data-testid="nikolaus-hint-go">Zum Stiefel</button>
          {!userId && <Link to="/login" className="tls-nikolaus-hint__link" onClick={() => setOpen(false)}>Anmelden</Link>}
        </div>
      </div>
      <button type="button" className="tls-nikolaus-hint__close" aria-label="Hinweis schließen" onClick={() => setOpen(false)} data-testid="nikolaus-hint-close">×</button>
    </div>
  );
}

/** Ab hier öffnet sich der Stiefel von selbst - so lange braucht das Scrollen hinunter ungefähr. */
export const OPEN_AFTER_MS = 700;

/**
 * Zum Stiefel im Footer und ihn öffnen (#852): hinscrollen, Fokus darauf, kurz danach ein Klick - wie wenn man selbst
 * hineinschaut. Ohne Stiefel (noch nicht gemessen) passiert nichts.
 */
export function goToBoot(effective, doc = typeof document === "undefined" ? null : document) {
  const boot = doc?.getElementById(BOOT_ID);
  if (!boot) return false;
  boot.scrollIntoView?.({ behavior: effective === "subtle" ? "auto" : "smooth", block: "center" });
  boot.focus?.({ preventScroll: true });
  window.setTimeout(() => {
    const current = doc.getElementById(BOOT_ID);
    if (current && !current.classList.contains("tls-nikolaus-boot--used")) current.click();
  }, effective === "subtle" ? 0 : OPEN_AFTER_MS);
  return true;
}

/** Der kleine Stiefel im Kopf neben Kranz und Kalender (#852) - am Handy steht er stattdessen oben im Menü. */
export function Widget({ season }) {
  return (
    <button type="button" className="tls-nikolaus-widget" onClick={() => goToBoot(season.effective)} aria-label="Nikolaus – zum Stiefel" title="Der Nikolaus war da – zum Stiefel" data-testid="nikolaus-widget">
      <BootArt height={30} />
    </button>
  );
}

/** Der Eintrag ganz oben im Handy-Menü (#852): Menü zu, hinunter zum Stiefel, öffnen. */
export function MenuEntry({ season, onClose }) {
  const go = () => {
    onClose?.();
    window.setTimeout(() => goToBoot(season.effective), 50);
  };
  return (
    <button type="button" onClick={go} className="tls-nikolaus-menu" data-testid="season-menu-nikolaus">
      <span className="tls-nikolaus-menu__boot" aria-hidden="true"><BootArt height={34} /></span>
      <span className="tls-nikolaus-menu__title">Nikolaus</span>
      <span className="tls-nikolaus-menu__text">Der Nikolaus war da – zum Stiefel</span>
    </button>
  );
}

/** Eine Szene mit eigener Bedienung: der Footer-Platz versteckt den Stiefel nicht vor Screenreadern. */
export const season = { key: "nikolaus", Footer, Toast, Widget, MenuEntry, footerAccessible: true };
