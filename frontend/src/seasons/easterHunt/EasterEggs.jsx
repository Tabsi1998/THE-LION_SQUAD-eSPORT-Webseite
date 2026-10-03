import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { previewTokenFor } from "../preview";
import { useSeason } from "../SeasonContext";
import { hashString } from "../rng";
import { EggShape } from "./EggShape";
import { emitHuntProgress, fetchEggs, findEgg, reportHuntActive } from "./api";
import { EGG_SIZE, placeEggs } from "./placement";
import "./easter-hunt.css";

// Die Eier einer Seite (#646, #754, #755): der Server gibt nur die Eier dieser Seite (mit einem Schlüssel für diese
// Person); placement.js legt sie in Ecken echter Kanten. Jedes Ei ist ein Knopf („Osterei einsammeln“) - mit Maus,
// Finger und Tastatur erreichbar. Manche liegen ruhig, manche wackeln, wenn die Maus näher kommt, manche wippen ab
// und zu von selbst; ein Fund hebt das Ei kurz an und sagt, wie viele es jetzt sind. Gäste sehen die Eier und werden
// zum Anmelden eingeladen - gezählt wird nichts. In der Vorschau aus dem Admin (#757) liegen die Eier des Jahres auch
// im Entwurf; antippen zeigt Nummer und Hinweis.
// Die Eier liegen in Seitenkoordinaten unter der Kopfzeile, ihren Menüs und der Leiste unten: wer scrollt, sieht
// sie darunter verschwinden.

export const REFRESH_DELAYS = [150, 900, 2400];
const SCROLL_EVERY_MS = 250;
const RELAYOUT_MS = 200;
const NOTE_MS = 2600;
const POP_MS = 700;
const NOTE_MARGIN = 8;
const NOTE_GAP = 30;
const NEAR_PX = 90;
const NEAR_MS = 900;
const NEAR_EVERY_MS = 120;
const NEAR_REST_MS = 5000;

/**
 * Je Ei fest: leichte Neigung und Gemüt - ruhig, neugierig (wackelt kurz, wenn die Maus näher kommt) oder lebhaft
 * (wippt ab und zu von selbst); je ein Drittel.
 */
export function personality(egg) {
  const hash = hashString(`egg:${egg.egg_no}:${egg.pattern}`);
  return { tilt: (hash % 17) - 8, lively: egg.egg_no % 3 === 0, curious: egg.egg_no % 3 === 1, delay: 4 + (hash % 9) };
}

/** Die neugierigen Eier nahe am Zeiger (Seitenkoordinaten). */
export function eggsNear(point, eggs, placed, radius = NEAR_PX) {
  return eggs.filter((egg) => {
    const spot = placed[egg.egg_no];
    return Boolean(spot && !spot.pending && personality(egg).curious && Math.hypot(spot.x - point.x, spot.y - point.y) <= radius);
  }).map((egg) => egg.egg_no);
}

/**
 * Wo der Hinweis steht - die linke Kante in Fensterkoordinaten: mittig über dem Ei, aber ganz im Fenster (ein
 * Hinweis über den Rand machte die Seite am Handy dauerhaft breiter); unter dem Ei, wenn er darüber unter die
 * Kopfzeile geriete. `x`, `y`: die Eimitte im Fenster; `width`, `height`: die Größe des Hinweises.
 */
export function fitNote({ x, y, width, height }, { clientWidth, headerBottom = 0 }) {
  const left = Math.max(NOTE_MARGIN, Math.min(x - width / 2, clientWidth - NOTE_MARGIN - width));
  return { left: Math.round(left), below: y - NOTE_GAP - height < headerBottom + 4 };
}

function EggNote({ note, spot, route, onClose }) {
  const ref = useRef(null);
  const [fit, setFit] = useState(null);
  // Erst unsichtbar am linken Rand messen, dann an seinen Platz - so ragt er keinen Augenblick über das Fenster.
  // Einmal je Hinweis (der Schlüssel des Hinweises erzeugt ihn neu), vor dem Zeichnen.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof window === "undefined") return;
    const header = document.querySelector("header");
    const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const clientWidth = document.documentElement.clientWidth || window.innerWidth;
    const scroll = { x: window.scrollX || 0, y: window.scrollY || 0 };
    const next = fitNote({ x: spot.x - scroll.x, y: spot.y - scroll.y, width: node.offsetWidth, height: node.offsetHeight }, { clientWidth, headerBottom });
    setFit({ left: next.left + scroll.x, below: next.below });
  }, [spot.x, spot.y]);
  const classes = ["tls-egg-note", `tls-egg-note--${note.kind}`, fit?.below ? "tls-egg-note--below" : ""].filter(Boolean).join(" ");
  const sticky = note.kind === "guest" || note.kind === "done" || note.kind === "preview";
  const style = fit ? { left: fit.left, top: spot.y } : { left: 0, top: spot.y, visibility: "hidden" };
  return (
    <div ref={ref} className={classes} style={style} role={note.kind === "error" ? "alert" : undefined} data-testid="easter-egg-note">
      <span>{note.text}</span>
      {note.kind === "guest" ? <Link to={`/login?next=${encodeURIComponent(route)}`} className="tls-egg-note__link">Anmelden</Link> : null}
      {note.kind === "done" ? <Link to="/ostern" className="tls-egg-note__link">Zum Korb</Link> : null}
      {sticky ? <button type="button" className="tls-egg-note__close" onClick={onClose} aria-label="Hinweis schließen">×</button> : null}
    </div>
  );
}

export function EasterEggs({ season }) {
  const location = useLocation();
  const { user } = useAuth();
  const reduced = useReducedMotion() || season?.effective === "subtle";
  const [eggs, setEggs] = useState([]);
  const [placed, setPlaced] = useState({});
  const [popping, setPopping] = useState(null);
  const [note, setNote] = useState(null);
  const [live, setLive] = useState("");
  const [near, setNear] = useState({});
  const eggsRef = useRef([]);
  const placedRef = useRef({});
  const noteTimer = useRef(null);
  const route = location.pathname;
  const { preview: previewOn } = useSeason();
  const previewToken = previewOn ? previewTokenFor("easter_hunt") : null;
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchEggs(route, previewToken);
      setPreviewing(Boolean(data?.preview));
      reportHuntActive(data?.active);
      const fresh = data?.active ? (data.eggs || []).filter((egg) => !egg.found) : [];
      eggsRef.current = fresh;
      setEggs(fresh);
      return fresh;
    } catch {
      eggsRef.current = [];
      setEggs([]);
      return [];
    }
  }, [route, previewToken]);

  useEffect(() => {
    setPlaced({});
    setNote(null);
    void load();
  }, [load, user?.id]);

  const place = useCallback(() => {
    if (typeof document === "undefined" || !eggsRef.current.length) return;
    setPlaced((current) => placeEggs(eggsRef.current, { placed: current }));
  }, []);

  // Gleich nach dem Zeichnen (nicht erst später): die Nähe-Prüfung kennt so immer die Plätze, die man sieht.
  useLayoutEffect(() => {
    placedRef.current = placed;
  }, [placed]);

  // Neugierige Eier wackeln kurz, wenn die Maus näher kommt - nur mit Maus (am Handy gibt es keine Nähe), nie bei
  // „Bewegung reduzieren“, und danach eine Weile nicht wieder.
  useEffect(() => {
    if (reduced || !eggs.length || typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: fine)").matches) return undefined;
    let last = 0;
    const rested = new Map();
    const timers = new Set();
    const onMove = (event) => {
      const now = Date.now();
      if (now - last < NEAR_EVERY_MS) return;
      last = now;
      const point = { x: event.clientX + (window.scrollX || 0), y: event.clientY + (window.scrollY || 0) };
      const fresh = eggsNear(point, eggsRef.current, placedRef.current).filter((no) => (rested.get(no) || 0) <= now);
      if (!fresh.length) return;
      fresh.forEach((no) => rested.set(no, now + NEAR_REST_MS));
      setNear((current) => ({ ...current, ...Object.fromEntries(fresh.map((no) => [no, true])) }));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNear((current) => Object.fromEntries(Object.entries(current).filter(([no]) => !fresh.includes(Number(no)))));
      }, NEAR_MS);
      timers.add(timer);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      timers.forEach(clearTimeout);
    };
  }, [eggs, reduced]);

  // Nach dem Laden misst die Seite noch nach (Bilder, späte Karten); beim Scrollen bekommt das Ei an der Kopfzeile
  // seinen Platz, sobald man oben ist.
  // Ändert sich das Layout (Seite wächst, Fenster wird schmaler), suchen alle neu - nicht aber, wenn am Handy nur die
  // Adressleiste ein- und ausfährt (dann ändert sich bloß die Höhe des Fensters, die Seite liegt still).
  useEffect(() => {
    if (!eggs.length) return undefined;
    const timers = REFRESH_DELAYS.map((ms) => setTimeout(place, ms));
    let last = 0;
    let relayout = null;
    let width = window.innerWidth;
    const replaceAll = () => {
      clearTimeout(relayout);
      relayout = setTimeout(() => {
        setPlaced({});
        place();
      }, RELAYOUT_MS);
    };
    const onScroll = () => {
      const now = Date.now();
      if (now - last < SCROLL_EVERY_MS) return;
      last = now;
      place();
    };
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      replaceAll();
    };
    let height = document.body?.scrollHeight || 0;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = document.body?.scrollHeight || 0;
      if (Math.abs(next - height) < 2) return;
      height = next;
      replaceAll();
    });
    if (observer && document.body) observer.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(relayout);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [eggs, place]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // Gast-Einladung und voller Korb bleiben stehen, bis man sie schließt (sie haben einen Weg weiter); der Rest geht.
  // Der Hinweis merkt sich die Stelle des Eis - auch wenn das Ei schon weg ist oder die Seite neu misst.
  const showNote = (egg, kind, text) => {
    const spot = placed[egg.egg_no];
    clearTimeout(noteTimer.current);
    setNote(spot && !spot.pending ? { egg_no: egg.egg_no, kind, text, spot } : null);
    if (kind === "found" || kind === "error") noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  };

  const collect = async (egg, retried = false) => {
    if (previewing) {
      showNote(egg, "preview", `Vorschau: Ei ${egg.egg_no}${egg.hint ? ` – ${egg.hint}` : ""}`);
      return;
    }
    if (!user) {
      showNote(egg, "guest", "Anmelden, um Eier zu sammeln");
      return;
    }
    try {
      const result = await findEgg(egg.token);
      emitHuntProgress({ found: result.found, total: result.total, completed_at: result.completed_at, rank: result.rank, active: true });
      const text = result.completed_now
        ? `Korb voll! Platz ${result.rank}`
        : result.already ? "Das hast du schon" : `${result.found} von ${result.total}`;
      setLive(result.completed_now ? `Osterei gefunden – dein Korb ist voll, Platz ${result.rank}.` : `Osterei gefunden: ${result.found} von ${result.total}.`);
      setPopping(egg.egg_no);
      showNote(egg, result.completed_now ? "done" : "found", text);
      setTimeout(() => {
        eggsRef.current = eggsRef.current.filter((item) => item.egg_no !== egg.egg_no);
        setEggs(eggsRef.current);
        setPopping(null);
      }, reduced ? 0 : POP_MS);
    } catch (err) {
      const status = err?.response?.status;
      if ((status === 410 || status === 403) && !retried) {
        const fresh = await load();
        const again = fresh.find((item) => item.egg_no === egg.egg_no);
        if (again) await collect(again, true);
        return;
      }
      if (status === 409) {
        eggsRef.current = [];
        setEggs([]);
        return;
      }
      showNote(egg, "error", status === 429 ? "Langsam – ein Ei nach dem anderen." : "Hat nicht geklappt – gleich noch mal.");
    }
  };

  // Auch nach dem letzten Ei der Seite bleibt der Hinweis (etwa „Korb voll“) stehen, bis er geht.
  if (typeof document === "undefined" || (!eggs.length && !note)) return null;
  const visible = eggs.filter((egg) => placed[egg.egg_no] && !placed[egg.egg_no].pending);
  const renderEgg = (egg) => {
    const spot = placed[egg.egg_no];
    const { tilt, lively, delay } = personality(egg);
    // An der Kopfzeile hängt das Ei an einem Bändchen und pendelt; sonst liegt es schräg, manche wippen ab und zu.
    const hanging = spot.kind === "header";
    const classes = ["tls-egg", hanging ? "tls-egg--hanging" : "", reduced ? "tls-egg--still" : "", lively && !reduced && !hanging ? "tls-egg--lively" : "", near[egg.egg_no] ? "tls-egg--near" : "", popping === egg.egg_no ? `tls-egg--pop tls-egg--pop-${egg.pattern === "lion" ? "spin" : "lift"}` : ""].filter(Boolean).join(" ");
    const shape = <EggShape pattern={egg.pattern} size={EGG_SIZE} grass={spot.side === "bl" || spot.side === "br"} />;
    return (
      <button
        key={egg.egg_no}
        type="button"
        className={classes}
        style={{ left: spot.x, top: spot.y, "--egg-tilt": `${hanging ? 0 : tilt}deg`, "--egg-delay": `${delay}s` }}
        onClick={() => collect(egg)}
        aria-label="Osterei einsammeln"
        title="Osterei"
        data-testid={`easter-egg-${egg.egg_no}`}
        data-pattern={egg.pattern}
      >
        {hanging ? <span className="tls-egg__hang"><span className="tls-egg__ribbon" />{shape}</span> : shape}
      </button>
    );
  };
  const noteSpot = note?.spot || null;
  const renderNote = () => (note
    ? <EggNote key={`${note.egg_no}:${note.kind}:${note.text}`} note={note} spot={noteSpot} route={route} onClose={() => setNote(null)} />
    : null);
  return createPortal(
    <>
      <div className="tls-eggs" data-testid="easter-eggs">
        {visible.map(renderEgg)}
        {renderNote()}
      </div>
      <span className="tls-eggs__live" aria-live="polite" data-testid="easter-eggs-live">{live}</span>
    </>,
    document.body,
  );
}
