import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BracketTree, isTableFormat } from "@/components/tls/BracketTree";
import { runParticles } from "@/components/achievements/ceremony/particles";
import { resolveMediaUrl } from "@/lib/api";
import { lastStageId } from "@/lib/bracketPodium";
import { initials, isMatchDone } from "@/lib/slotSource";
import { matchRoundLabel } from "@/lib/tournamentLabels";
import { CAMERA, cameraStops, centeredView, clampView, fitZoom, nearestStop, rectFits, stageTransform, unionRect, viewBetween, viewForRect } from "@/lib/tvCamera";
import { isLiveMatch, liveZoomPlan } from "@/lib/tvLive";
import { COLLECT_AFTER, MOMENT_MS } from "@/lib/tvMoments";
import { TRAVEL, advancementsOf, landFrame, planTravel, rideFrame, routeLength, routePath, travelRoute, travelTotal } from "@/lib/tvTravel";
import { TV_STAGE_UNIT_PX, stageBase, treeBox, treeCssVars, treeMinZoom } from "@/lib/tvType";
import { TvChampionCard, TvCollectiveCard, TvLiveBanner, TvResultCard, avatarOfRegistration, nameOfRegistration } from "./TvMoments";
import { TvTreeContext, TvTreeNode } from "./TvTreeNode";
import { useTv } from "./TvScreen";

// Der Turnierbaum am Beamer (#1115-#1119): der Baum auf einer festen Bühne, darüber die Kamera, die Fahrten über die
// Linien, der goldene Weg und die Momente. Die Bühne wird nur verschoben und vergrößert - ein neues Ergebnis baut den
// Baum nicht neu auf, und die Kamera springt nicht. Immer nur ein Moment: Die Seite gibt ihn herein (`moment`), die
// Bühne spielt ihn ab und meldet `onMomentDone`. Mit „Bewegung reduzieren“ fährt, zoomt und fliegt nichts: die Kamera
// wechselt in ruhigen Schritten, Namen stehen sofort am neuen Platz, kein Konfetti.
// Seit #1564 je Turnier-Ereignis ein Moment (lib/tvMoments.momentsFromChange): Weiterrücken fährt die gezeichnete Linie
// entlang (dieselbe Führung wie im Web-Baum), die Auslosung lässt die Namen nacheinander in die Läufe kommen, beim
// Zusammenlegen fliegen die Namen in den Sammellauf und die frei gewordene Station leuchtet kurz im Banner, „entfällt“
// lässt die Karte zurücktreten. Für 5 m Abstand: große Banner, ruhiges Tempo, eine Bewegung nach der anderen.

const FINISHED = new Set(["completed", "results_published", "archived", "cancelled"]);
const EMPTY = new Set();
const NO_MAP = new Map();
// Auslosung: so viel Abstand zwischen zwei Namen - bei 40 Namen bleibt es unter 2 Sekunden, am TV ruhiger als im Web.
const DRAW_TOTAL_MS = 1800;
const DRAW_STEP = Object.freeze({ min: 40, max: 140 });
// So lange stehen die Namen nach der Auslosung, bevor der Moment endet; so lange braucht eine Zeile zum Einblenden.
const DRAW_HOLD_MS = 1400;
const ROW_IN_MS = 500;

/** „Switch 3 und Switch 4“ */
function listText(items) {
  if (items.length < 2) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

function frameOf(view, viewport) {
  return { x: view.x, y: view.y, w: viewport.w / view.zoom, h: viewport.h / view.zoom };
}

function inside(rect, frame, margin = 0) {
  return rect.x >= frame.x + margin && rect.y >= frame.y + margin && rect.x + rect.w <= frame.x + frame.w - margin && rect.y + rect.h <= frame.y + frame.h - margin;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Wo die Karten und Plätze auf der Bühne liegen (Bühnen-Punkte) - gemessen, so wie der Browser sie gesetzt hat. */
function measureStage(stage) {
  const empty = { cards: new Map(), slots: new Map(), regs: new Map(), blocks: new Map() };
  if (!stage) return empty;
  const base = stage.getBoundingClientRect();
  const scale = stage.offsetWidth ? base.width / stage.offsetWidth : 1;
  const local = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: (rect.left - base.left) / scale, y: (rect.top - base.top) / scale, w: rect.width / scale, h: rect.height / scale };
  };
  const out = { cards: new Map(), slots: new Map(), regs: new Map(), blocks: new Map(), local };
  stage.querySelectorAll("[data-tv-card]").forEach((element) => out.cards.set(element.getAttribute("data-tv-card"), local(element)));
  stage.querySelectorAll("[data-tv-slot]").forEach((element) => {
    const rect = local(element);
    out.slots.set(element.getAttribute("data-tv-slot"), rect);
    const node = element.closest("[data-tv-node]");
    const registrationId = element.getAttribute("data-tv-reg");
    if (node && registrationId) out.regs.set(`${node.getAttribute("data-tv-node")}:${registrationId}`, rect);
  });
  stage.querySelectorAll("[data-tv-card]").forEach((element) => {
    const block = element.closest("[data-tv-block]");
    if (block) out.blocks.set(element.getAttribute("data-tv-card"), block.getAttribute("data-tv-block"));
  });
  return out;
}

/**
 * Der Weg einer Fahrt entlang der gezeichneten Linie (#1564): dieselben Punkte wie die Linie im Baum (`data-points`,
 * aus lib/bracketLines). Start in der Zeile des Namens: waagrecht bis zum ersten Knick, dann auf die Linie.
 */
function lineRoute(stage, geometry, fromMatch, toMatch, toSlot, startY) {
  if (!stage || !geometry.local) return null;
  const path = (toSlot && stage.querySelector(`path[data-from="${fromMatch}"][data-to="${toMatch}"][data-to-slot="${toSlot}"]`))
    || stage.querySelector(`path[data-from="${fromMatch}"][data-to="${toMatch}"]`);
  const raw = path?.getAttribute("data-points");
  const svg = path?.ownerSVGElement;
  if (!raw || !svg) return null;
  const origin = geometry.local(svg);
  const points = raw.split(" ").map((pair) => pair.split(",").map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => ({ x: x + origin.x, y: y + origin.y }));
  if (points.length < 2) return null;
  const start = startY ?? points[0].y;
  return { kind: "line", points: [{ x: points[0].x, y: start }, { x: points[1].x, y: start }, ...points.slice(1)] };
}

/** Ein Weg zwischen zwei Karten: im selben Block in der nächsten Spalte die Linie entlang, sonst ein ruhiger Bogen. */
function routeBetween(geometry, fromMatch, toMatch, fromY, toY, colGap) {
  const a = geometry.cards.get(fromMatch);
  const b = geometry.cards.get(toMatch);
  if (!a || !b) return null;
  const from = { x: a.x + a.w, y: fromY ?? a.y + a.h / 2 };
  const to = { x: b.x, y: toY ?? b.y + b.h / 2 };
  const neighbour = geometry.blocks.get(fromMatch) === geometry.blocks.get(toMatch) && b.x > from.x && b.x - from.x <= colGap * 1.6;
  return travelRoute(from, to, { curved: !neighbour });
}

function useElementSize(ref, measure) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => {
      const next = measure(element);
      if (!next.w || !next.h) return;
      setSize((current) => (current && Math.abs(current.w - next.w) < 0.5 && Math.abs(current.h - next.h) < 0.5 ? current : next));
    };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, measure]);
  return size;
}

const viewportSize = (element) => ({ w: element.clientWidth, h: element.clientHeight, base: stageBase(window.innerWidth, window.innerHeight) });
const contentSize = (element) => ({ w: element.offsetWidth, h: element.offsetHeight });

export function TvBracketStage({ data, moment = null, onMomentDone, hiddenSlots = EMPTY, onReveal, champion = null, championParked = false, onChampionParked, onParkSpot, gong = null, active = true, resultTags = NO_MAP }) {
  const { motionOn, textSize, settings } = useTv();
  const viewportRef = useRef(null);
  const stageRef = useRef(null);
  const contentRef = useRef(null);
  const confettiRef = useRef(null);
  const viewport = useElementSize(viewportRef, viewportSize);
  const content = useElementSize(contentRef, contentSize);
  const matches = useMemo(() => data?.matches_v2 || [], [data?.matches_v2]);
  const stages = useMemo(() => data?.stages || [], [data?.stages]);
  const registrations = data?.registrations || [];
  const box = treeBox(textSize);
  const minZoom = treeMinZoom(textSize);
  const base = viewport?.base || 1;
  const vp = useMemo(() => (viewport ? { w: viewport.w / base, h: viewport.h / base } : null), [viewport, base]);
  const colGapPx = box.colGap * TV_STAGE_UNIT_PX;
  const columns = vp ? Math.max(1, Math.floor((vp.w + colGapPx) / (box.card * TV_STAGE_UNIT_PX + colGapPx))) : 4;
  // Was der Baum über das Bild wissen muss: Spalten, Fläche in Einheiten, wie weit er verkleinert werden darf.
  const unitsW = vp ? Math.round(vp.w / TV_STAGE_UNIT_PX) : 0;
  const unitsH = vp ? Math.round(vp.h / TV_STAGE_UNIT_PX) : 0;
  const tvLayout = useMemo(() => ({ columns, viewport: unitsW && unitsH ? { w: unitsW, h: unitsH } : null, minZoom, textSize }), [columns, unitsW, unitsH, minZoom, textSize]);

  const [banner, setBanner] = useState(null);
  const [marks, setMarks] = useState(NO_MAP);
  const [drawRows, setDrawRows] = useState(NO_MAP);
  const [drawStep, setDrawStep] = useState(60);
  const [card, setCard] = useState(null);
  const [rides, setRides] = useState(null);
  const [landing, setLanding] = useState(EMPTY);
  const [goldCount, setGoldCount] = useState(0);
  const [goldPaths, setGoldPaths] = useState([]);
  const [championCenter, setChampionCenter] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [parkSpot, setParkSpot] = useState("");

  // ------------------------------------------------------------ Kamera
  const plan = useMemo(() => {
    if (!vp || !content) return null;
    const fit = fitZoom(content, vp, { minZoom });
    if (fit.fits) return { mode: "still", view: centeredView(content, vp, fit.zoom) };
    return { mode: "tour", zoom: 1 };
  }, [vp, content, minZoom]);

  const viewRef = useRef({ x: 0, y: 0, zoom: 1 });
  const animationRef = useRef(0);
  const pendingRef = useRef(null);
  const appliedRef = useRef(false);
  const baseRef = useRef(base);
  const motionRef = useRef(motionOn);
  const planRef = useRef(plan);
  const vpRef = useRef(vp);
  const contentSizeRef = useRef(content);
  const dataRef = useRef(data);
  const championRef = useRef(champion);
  useEffect(() => {
    motionRef.current = motionOn;
    planRef.current = plan;
    vpRef.current = vp;
    contentSizeRef.current = content;
    dataRef.current = data;
    championRef.current = champion;
  });

  const apply = useCallback((view) => {
    viewRef.current = view;
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.transform = stageTransform(view, baseRef.current);
    stage.setAttribute("data-tv-scale", (baseRef.current * view.zoom).toFixed(4));
    stage.setAttribute("data-tv-zoom", view.zoom.toFixed(3));
    stage.setAttribute("data-tv-view", `${Math.round(view.x)},${Math.round(view.y)}`);
  }, []);

  /** Eine laufende Fahrt anhalten - wer auf sie wartet, darf weitermachen. */
  const cancelMove = useCallback(() => {
    if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    stageRef.current?.removeAttribute("data-tv-moving");
    const resolve = pendingRef.current;
    pendingRef.current = null;
    resolve?.();
  }, []);

  /** Zur Ansicht fahren - ohne Bewegung ein ruhiger Schnitt. Eine neue Fahrt löst die alte ab. */
  const moveTo = useCallback((target, ms) => new Promise((resolve) => {
    cancelMove();
    const from = viewRef.current;
    const area = vpRef.current;
    if (!motionRef.current || !ms || !area || !appliedRef.current) {
      apply(target);
      resolve();
      return;
    }
    pendingRef.current = resolve;
    stageRef.current?.setAttribute("data-tv-moving", "1");
    const started = window.performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / ms);
      apply(viewBetween(from, target, t, area));
      if (t < 1) animationRef.current = window.requestAnimationFrame(step);
      else {
        animationRef.current = 0;
        pendingRef.current = null;
        stageRef.current?.removeAttribute("data-tv-moving");
        resolve();
      }
    };
    animationRef.current = window.requestAnimationFrame(step);
  }), [apply, cancelMove]);

  useLayoutEffect(() => {
    baseRef.current = base;
    if (appliedRef.current) apply(viewRef.current);
  }, [base, apply]);

  // Steht der Baum still, zeigt die Kamera ihn ganz - auch wenn er wächst (neue Namen) oder das Bild sich ändert.
  useLayoutEffect(() => {
    if (!plan || moment) return;
    if (plan.mode === "still") {
      if (!appliedRef.current) {
        apply(plan.view);
        appliedRef.current = true;
      } else if (plan.view.zoom < viewRef.current.zoom - 0.001) {
        // Der Baum ist gewachsen (neuer Name, Schrift nachgeladen): sofort auf die neue Größe - eine Fahrt würde ihn
        // 600 ms lang mit dem alten, zu großen Maßstab über den Rand (und den sicheren Bereich) schieben.
        cancelMove();
        apply(plan.view);
      } else moveTo(plan.view, 600);
    } else if (!appliedRef.current) {
      apply(clampView({ x: 0, y: 0, zoom: plan.zoom }, content, vp));
      appliedRef.current = true;
    }
  }, [plan, moment, apply, moveTo, cancelMove, content, vp]);

  /** Die Karten mit „läuft“ und „als Nächstes dran“ - daraus die Halte der Kamera. */
  const computeStops = useCallback(() => {
    const area = vpRef.current;
    const size = contentSizeRef.current;
    if (!area || !size) return [];
    const geometry = measureStage(stageRef.current);
    const byId = new Map((dataRef.current?.matches_v2 || []).map((match) => [match.id, match]));
    const boxes = [...geometry.cards.entries()].map(([id, rect]) => {
      const match = byId.get(id);
      const status = String(match?.status || "").toLowerCase();
      return { ...rect, live: isLiveMatch(match), current: !isMatchDone(match) && ["ready", "scheduled"].includes(status) };
    });
    return cameraStops({ content: size, viewport: area, zoom: planRef.current?.zoom || 1, boxes });
  }, []);

  // Kamerafahrt über einen großen Baum: Halt, Fahrt, Halt … Ein Moment hält sie an; danach geht es vom nächstgelegenen
  // Halt weiter. Neue Daten ändern nur die Halte, nicht die Stelle, an der die Kamera gerade steht. Zeigt die
  // Wiedergabeliste (#1121) gerade eine andere Folie, wartet die Kamera.
  const tourOn = plan?.mode === "tour" && !moment && active;
  useEffect(() => {
    if (!tourOn) return undefined;
    let cancelled = false;
    let timer = 0;
    const wait = (ms) => new Promise((resolve) => { timer = window.setTimeout(resolve, ms); });
    const run = async () => {
      let stops = computeStops();
      if (!stops.length) return;
      let index = nearestStop(stops, viewRef.current);
      await moveTo(stops[index], CAMERA.moveMs);
      while (!cancelled) {
        const hold = stops[index]?.holdMs || CAMERA.holdMs;
        stageRef.current?.setAttribute("data-tv-stop", String(index));
        stageRef.current?.setAttribute("data-tv-hold", String(hold));
        await wait(hold);
        if (cancelled) return;
        stops = computeStops();
        if (!stops.length) return;
        index = (nearestStop(stops, viewRef.current) + 1) % stops.length;
        await moveTo(stops[index], CAMERA.moveMs);
      }
    };
    run();
    // Die Fahrt selbst läuft weiter, bis eine neue sie ablöst (Moment, stiller Baum) - so bleibt die Kamera nie hängen.
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tourOn, computeStops, moveTo]);

  // ------------------------------------------------------------ Goldener Weg (#1119)
  const showGold = Boolean(champion) && (championParked || moment?.type === "champion");
  useLayoutEffect(() => {
    if (!champion || !showGold) {
      setGoldPaths((current) => (current.length ? [] : current));
      return;
    }
    const geometry = measureStage(stageRef.current);
    const paths = champion.segments.map((segment, index) => {
      // Der goldene Weg liegt auf den gezeichneten Linien (#1564) - kein Bogen quer über den Baum.
      const route = lineRoute(stageRef.current, geometry, segment.from, segment.to, null, null) || routeBetween(geometry, segment.from, segment.to, null, null, colGapPx);
      return route ? { id: `${segment.from}>${segment.to}`, index, d: routePath(route) } : null;
    }).filter(Boolean);
    setGoldPaths((current) => (JSON.stringify(current) === JSON.stringify(paths) ? current : paths));
  }, [champion, showGold, content, colGapPx, data]);

  const drawnGold = championParked ? Infinity : moment?.type === "champion" ? goldCount : 0;
  const treeValue = useMemo(() => {
    const goldCards = new Set();
    const goldRows = new Set();
    if (champion && showGold) {
      champion.path.forEach((id, index) => {
        if (index > drawnGold) return;
        goldCards.add(id);
        goldRows.add(`${id}:${champion.winnerId}`);
      });
    }
    return {
      matches,
      hiddenSlots,
      landing,
      goldCards,
      goldRows,
      finished: FINISHED.has(String(data?.tournament?.status || "")),
      lastStageId: lastStageId(matches, stages),
      isTable: (match) => isTableFormat([match]),
      marks,
      drawRows,
      drawStep,
    };
  }, [matches, stages, hiddenSlots, landing, champion, showGold, drawnGold, data?.tournament?.status, marks, drawRows, drawStep]);

  // ------------------------------------------------------------ Geparkte Siegerkarte: eine freie Ecke, sonst die Kopfleiste
  useLayoutEffect(() => {
    if (!championParked || !champion) {
      setParkSpot("");
      return;
    }
    const element = viewportRef.current;
    if (!element || plan?.mode !== "still") {
      setParkSpot("header");
      return;
    }
    const area = element.getBoundingClientRect();
    const unit = Math.min(window.innerHeight / 100, window.innerWidth * 0.0075);
    const card = { w: unit * 34, h: unit * 8.5 };
    const margin = unit * 1.2;
    const corners = {
      tr: { x: area.width - card.w - margin, y: margin },
      br: { x: area.width - card.w - margin, y: area.height - card.h - margin },
      bl: { x: margin, y: area.height - card.h - margin },
      tl: { x: margin, y: margin },
    };
    const taken = [...element.querySelectorAll("[data-tv-node]")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left - area.left, y: rect.top - area.top, w: rect.width, h: rect.height };
    });
    const free = Object.entries(corners).find(([, spot]) => !taken.some((rect) => overlaps(rect, { ...spot, ...card })));
    setParkSpot(free ? free[0] : "header");
  }, [championParked, champion, plan, content, viewport]);

  useEffect(() => {
    onParkSpot?.(parkSpot);
  }, [parkSpot, onParkSpot]);

  // ------------------------------------------------------------ Momente
  const tagsRef = useRef(resultTags);
  useEffect(() => {
    tagsRef.current = resultTags;
  });
  const finishRef = useRef(onMomentDone);
  const revealRef = useRef(onReveal);
  const parkedRef = useRef(onChampionParked);
  useEffect(() => {
    finishRef.current = onMomentDone;
    revealRef.current = onReveal;
    parkedRef.current = onChampionParked;
  });

  const momentId = moment?.id || null;
  useEffect(() => {
    if (!moment) return undefined;
    const session = { cancelled: false, finished: false, timers: [], frames: [], particles: [] };
    const sleep = (ms) => new Promise((resolve) => { session.timers.push(window.setTimeout(resolve, ms)); });
    const nextFrame = () => new Promise((resolve) => { session.frames.push(window.requestAnimationFrame(() => resolve())); });
    const byId = () => new Map((dataRef.current?.matches_v2 || []).map((match) => [match.id, match]));
    const savedView = viewRef.current;
    const area = () => vpRef.current;
    const size = () => contentSizeRef.current;

    const returnCamera = async () => {
      if (!area() || !size()) return;
      const current = planRef.current;
      await moveTo(current?.mode === "still" ? current.view : clampView(savedView, size(), area()), 1200);
    };

    const runLive = async () => {
      const all = byId();
      const ids = (moment.matchIds || []).filter((id) => isLiveMatch(all.get(id)));
      const zoom = liveZoomPlan(ids, [...all.values()], { roundLabel: matchRoundLabel });
      if (!zoom) return;
      setBanner({ text: zoom.text, kind: "live" });
      if (motionRef.current && area() && size()) {
        const geometry = measureStage(stageRef.current);
        const rect = unionRect(zoom.matchIds.map((id) => geometry.cards.get(id)));
        if (rect) {
          const target = viewForRect(rect, size(), area(), { minZoom: Math.max(minZoom, viewRef.current.zoom), maxZoom: CAMERA.focusMaxZoom });
          await moveTo(target, 1000);
          if (session.cancelled) return;
          await sleep(2300);
          if (session.cancelled) return;
          await returnCamera();
        } else await sleep(MOMENT_MS.live);
      } else await sleep(MOMENT_MS.live);
      if (!session.cancelled) setBanner(null);
    };

    const travel = async (decided) => {
      const geometry = measureStage(stageRef.current);
      const stage = stageRef.current;
      const lastStage = lastStageId(dataRef.current?.matches_v2 || [], dataRef.current?.stages || []);
      const nameOf = nameOfRegistration(dataRef.current?.registrations || []);
      const avatarOf = avatarOfRegistration(dataRef.current?.registrations || []);
      const list = [];
      decided.forEach((match, matchIndex) => {
        const moves = advancementsOf(match, dataRef.current?.matches_v2 || [], { lastStage: !lastStage || (match.stage_id || "__default") === lastStage, table: isTableFormat([match]) });
        let wins = 0;
        let drops = 0;
        for (const move of moves) {
          if (!move.target || !["win", "drop"].includes(move.kind)) continue;
          const slotKey = `${move.target.matchId}:${move.target.slotIndex}`;
          const source = geometry.regs.get(`${match.id}:${move.registrationId}`);
          const slot = geometry.slots.get(slotKey);
          // Entlang der gezeichneten Linie (#1564); ohne gemessene Linie wie bisher von Karte zu Karte.
          const route = source && slot
            ? lineRoute(stage, geometry, match.id, move.target.matchId, move.target.slot, source.y + source.h / 2) || routeBetween(geometry, match.id, move.target.matchId, source.y + source.h / 2, slot.y + slot.h / 2, colGapPx)
            : null;
          if (!route) {
            revealRef.current?.([slotKey]);
            continue;
          }
          const avatarSize = box.avatar * TV_STAGE_UNIT_PX;
          const name = nameOf(move.registrationId);
          list.push({
            id: `${match.id}-${move.registrationId}`,
            slotKey,
            kind: move.kind,
            matchIndex,
            order: move.kind === "win" ? wins++ : drops++,
            route,
            length: routeLength(route),
            land: { x: slot.x + box.padX * TV_STAGE_UNIT_PX + avatarSize / 2, y: slot.y + slot.h / 2 },
            label: initials(name),
            avatar: avatarOf(move.registrationId),
            source: geometry.cards.get(match.id),
            target: geometry.cards.get(move.target.matchId),
          });
        }
      });
      await fly(list);
    };

    /** Die Fahrten abspielen: Kamera mitnehmen, Namen über die Wege, landen, Platz aufdecken. */
    const fly = async (list) => {
      if (!list.length) return;
      const schedule = planTravel(list);
      const timing = new Map(schedule.map((entry) => [entry.id, entry]));
      const total = travelTotal(schedule);
      // Die Kamera: passt alles ins Bild, zeigt sie es; sonst fährt sie vom Start zum Ziel mit.
      if (area() && size()) {
        const sources = unionRect(list.map((ride) => ride.source));
        const targets = unionRect(list.map((ride) => ride.target));
        const both = unionRect([sources, targets]);
        const zoom = viewRef.current.zoom;
        const frame = frameOf(viewRef.current, area());
        if (rectFits(both, area(), zoom)) {
          if (!inside(both, frame)) await moveTo(viewForRect(both, size(), area(), { minZoom: zoom, maxZoom: zoom, fill: 1 }), 700);
        } else {
          await moveTo(viewForRect(sources, size(), area(), { minZoom: zoom, maxZoom: zoom, fill: 1 }), 700);
          const firstEnd = Math.min(...schedule.map((entry) => entry.delay)) + 200;
          session.timers.push(window.setTimeout(() => moveTo(viewForRect(targets, size(), area(), { minZoom: zoom, maxZoom: zoom, fill: 1 }), Math.max(600, total - firstEnd - 400)), firstEnd));
        }
      }
      if (session.cancelled) return;
      setRides(list);
      await nextFrame();
      await nextFrame();
      if (session.cancelled) return;
      const stage = stageRef.current;
      const riders = new Map(list.map((ride) => [ride.id, { comet: stage?.querySelector(`[data-tv-rider="${ride.id}"]`), trail: stage?.querySelector(`[data-tv-trail="${ride.id}"]`), drop: stage?.querySelector(`[data-tv-drop="${ride.id}"]`) }]));
      const landed = new Set();
      await new Promise((resolve) => {
        const started = window.performance.now();
        const step = (now) => {
          if (session.cancelled) {
            resolve();
            return;
          }
          const elapsed = now - started;
          for (const ride of list) {
            const entry = timing.get(ride.id);
            const nodes = riders.get(ride.id);
            const t = (elapsed - entry.delay) / entry.duration;
            if (!nodes?.comet) continue;
            if (t < 0) continue;
            if (t <= 1) {
              // Weich an, weich ab, leicht angehoben (lib/tvTravel.rideFrame); die Linie zeichnet sich hinter ihm her.
              const frame = rideFrame(ride.route, t);
              nodes.comet.style.opacity = "1";
              nodes.comet.style.transform = `translate(${frame.x}px, ${frame.y}px) scale(${frame.scale.toFixed(4)})`;
              if (nodes.trail) {
                nodes.trail.style.opacity = "1";
                nodes.trail.style.strokeDashoffset = String(1 - frame.drawn);
              }
              if (nodes.drop) nodes.drop.style.opacity = "1";
            } else {
              // Weich aufsetzen: ausfedernd in den Platz, etwas kleiner, ausblenden (lib/tvTravel.landFrame).
              const end = ride.route.points[ride.route.points.length - 1];
              const share = Math.min(1, (elapsed - entry.delay - entry.duration) / TRAVEL.landMs);
              const frame = landFrame(end, ride.land, share);
              nodes.comet.style.transform = `translate(${frame.x}px, ${frame.y}px) scale(${frame.scale.toFixed(4)})`;
              nodes.comet.style.opacity = String(frame.opacity);
              if (nodes.trail) nodes.trail.style.opacity = String(frame.opacity);
              if (share >= 1 && !landed.has(ride.id)) {
                landed.add(ride.id);
                if (nodes.drop) nodes.drop.style.opacity = "0";
                revealRef.current?.([ride.slotKey]);
                setLanding((current) => new Set([...current, ride.slotKey]));
                session.timers.push(window.setTimeout(() => setLanding((current) => {
                  const next = new Set(current);
                  next.delete(ride.slotKey);
                  return next;
                }), 1000));
              }
            }
          }
          if (landed.size < list.length && elapsed < total + 1500) session.frames.push(window.requestAnimationFrame(step));
          else resolve();
        };
        session.frames.push(window.requestAnimationFrame(step));
      });
      if (session.cancelled) return;
      revealRef.current?.(list.map((ride) => ride.slotKey));
      await sleep(250);
      setRides(null);
    };

    const runResult = async () => {
      const all = byId();
      const decided = (moment.items || []).map((id) => all.get(id)).filter((match) => match && isMatchDone(match) && (match.results || []).length);
      const revealAll = () => {
        const keys = [];
        for (const match of decided) {
          for (const move of advancementsOf(match, dataRef.current?.matches_v2 || [])) if (move.target) keys.push(`${move.target.matchId}:${move.target.slotIndex}`);
        }
        revealRef.current?.(keys);
      };
      if (!decided.length) return;
      if (settings.result_sound && gong) gong.play();
      setCard({ ids: decided.map((match) => match.id), many: decided.length > COLLECT_AFTER });
      // Kampflos: der Kopf der Karte im Baum blinkt einmal, solange der Moment läuft.
      const walkovers = decided.filter((match) => tagsRef.current.get(match.id) === "walkover").map((match) => match.id);
      if (walkovers.length && motionRef.current) setMarks(new Map(walkovers.map((id) => [id, "walkover"])));
      await sleep(decided.length > COLLECT_AFTER ? MOMENT_MS.collective : MOMENT_MS.result);
      if (session.cancelled) return;
      setCard(null);
      if (!motionRef.current) {
        revealAll();
        return;
      }
      await sleep(450);
      if (session.cancelled) return;
      await travel(decided);
      if (!session.cancelled) {
        revealAll();
        if (planRef.current?.mode === "tour") await sleep(400);
      }
    };

    /** Fokus auf Karten, wenn die Kamera fährt und sie nicht schon im Bild sind. */
    const focusCards = async (ids, ms = 900) => {
      if (!motionRef.current || planRef.current?.mode !== "tour" || !area() || !size()) return;
      const geometry = measureStage(stageRef.current);
      const rect = unionRect(ids.map((id) => geometry.cards.get(id)));
      if (!rect) return;
      const zoom = viewRef.current.zoom;
      if (!inside(rect, frameOf(viewRef.current, area()))) await moveTo(viewForRect(rect, size(), area(), { minZoom: zoom, maxZoom: zoom, fill: 1 }), ms);
    };

    // Auslosung (#1564): die Namen kommen nacheinander in die Läufe - CSS je Zeile (tv-row--draw), versetzt.
    const runDraw = async () => {
      const rows = moment.rows || [];
      const keys = rows.map((row) => `${row.matchId}:${row.slotIndex}`);
      const heats = new Set(rows.map((row) => row.matchId)).size;
      setBanner({ text: `Auslosung · ${rows.length} ${rows.length === 1 ? "Name" : "Namen"} in ${heats} ${heats === 1 ? "Lauf" : "Läufen"}`, kind: "event" });
      if (!motionRef.current) {
        revealRef.current?.(keys);
        await sleep(MOMENT_MS.draw);
        if (!session.cancelled) setBanner(null);
        return;
      }
      await focusCards([...new Set(rows.map((row) => row.matchId))], 900);
      if (session.cancelled) return;
      const step = Math.round(Math.max(DRAW_STEP.min, Math.min(DRAW_STEP.max, DRAW_TOTAL_MS / Math.max(1, rows.length))));
      setDrawStep(step);
      setDrawRows(new Map(rows.map((row) => [`${row.matchId}:${row.slotIndex}`, { index: row.index }])));
      revealRef.current?.(keys);
      await sleep(rows.length * step + ROW_IN_MS + DRAW_HOLD_MS);
      if (session.cancelled) return;
      setDrawRows(NO_MAP);
      setBanner(null);
    };

    // Läufe zusammengelegt (#1564): die alten Läufe treten zurück, die Namen fliegen in den Sammellauf, die frei
    // gewordene Station leuchtet kurz im Banner.
    const runMerge = async () => {
      const all = byId();
      const moves = moment.moves || [];
      const keys = moves.map((move) => `${move.matchId}:${move.slotIndex}`);
      const into = [...new Set(moves.map((move) => all.get(move.matchId)?.match_key).filter(Boolean))];
      const freed = moment.freed || [];
      setBanner({
        text: `Läufe zusammengelegt${into.length ? ` · jetzt ${into.length === 1 ? "Lauf" : "Läufe"} ${listText(into)}` : ""}`,
        kind: "event",
        note: freed.length ? `${listText(freed)} ${freed.length === 1 ? "ist" : "sind"} frei` : "",
      });
      const faded = [...(moment.merged || []), ...(moment.dropped || [])];
      setMarks(new Map(faded.map((id) => [id, "fate"])));
      if (!motionRef.current) {
        revealRef.current?.(keys);
        await sleep(MOMENT_MS.merge);
        if (!session.cancelled) {
          setMarks(NO_MAP);
          setBanner(null);
        }
        return;
      }
      await sleep(600);
      if (session.cancelled) return;
      const geometry = measureStage(stageRef.current);
      const nameOf = nameOfRegistration(dataRef.current?.registrations || []);
      const avatarOf = avatarOfRegistration(dataRef.current?.registrations || []);
      const avatarSize = box.avatar * TV_STAGE_UNIT_PX;
      const list = [];
      const order = new Map();
      for (const move of moves) {
        const slotKey = `${move.matchId}:${move.slotIndex}`;
        const card = geometry.cards.get(move.from.matchId);
        const row = geometry.slots.get(`${move.from.matchId}:${move.from.slotIndex}`);
        const slot = geometry.slots.get(slotKey);
        if (!card || !slot) {
          revealRef.current?.([slotKey]);
          continue;
        }
        const startY = row ? row.y + row.h / 2 : card.y + card.h / 2;
        const into = geometry.cards.get(move.matchId);
        // Läufe derselben Runde stehen untereinander: der Name nimmt die Gasse rechts daneben - nie quer über Karten.
        const gasse = into && Math.abs(into.x - card.x) < 2 ? card.x + card.w + colGapPx / 2 : null;
        const route = gasse !== null
          ? { kind: "line", points: [{ x: card.x + card.w, y: startY }, { x: gasse, y: startY }, { x: gasse, y: slot.y + slot.h / 2 }, { x: into.x + into.w, y: slot.y + slot.h / 2 }] }
          : routeBetween(geometry, move.from.matchId, move.matchId, startY, slot.y + slot.h / 2, colGapPx);
        if (!route) {
          revealRef.current?.([slotKey]);
          continue;
        }
        const matchIndex = order.has(move.from.matchId) ? order.get(move.from.matchId) : order.size;
        order.set(move.from.matchId, matchIndex);
        const name = nameOf(move.registrationId);
        list.push({
          id: `merge-${move.matchId}-${move.registrationId}`,
          slotKey,
          kind: "win",
          matchIndex,
          order: list.filter((ride) => ride.matchIndex === matchIndex).length,
          route,
          length: routeLength(route),
          land: { x: slot.x + box.padX * TV_STAGE_UNIT_PX + avatarSize / 2, y: slot.y + slot.h / 2 },
          label: initials(name),
          avatar: avatarOf(move.registrationId),
          source: card,
          target: geometry.cards.get(move.matchId),
        });
      }
      await fly(list);
      if (session.cancelled) return;
      revealRef.current?.(keys);
      await sleep(900);
      if (session.cancelled) return;
      setMarks(NO_MAP);
      setBanner(null);
    };

    // Entfällt (#1564): Reset nicht nötig, gestrichen - die Karte tritt zurück, der Banner sagt warum.
    const runMark = async () => {
      const items = moment.items || [];
      if (!items.length) return;
      setBanner({ text: items.map((item) => `${item.name} · ${item.label}`).join("  ·  "), kind: "event" });
      await focusCards(items.map((item) => item.matchId), 900);
      if (session.cancelled) return;
      if (motionRef.current) setMarks(new Map(items.map((item) => [item.matchId, moment.kind || "fate"])));
      await sleep(MOMENT_MS.mark);
      if (session.cancelled) return;
      setMarks(NO_MAP);
      setBanner(null);
    };

    const runChampion = async () => {
      const winner = championRef.current;
      if (!winner) return;
      setGoldCount(0);
      const geometry = measureStage(stageRef.current);
      const tour = planRef.current?.mode === "tour";
      const focus = async (ids, ms) => {
        if (!tour || !area() || !size()) return;
        const rect = unionRect(ids.map((id) => geometry.cards.get(id)));
        if (!rect) return;
        const zoom = viewRef.current.zoom;
        if (!inside(rect, frameOf(viewRef.current, area()))) await moveTo(viewForRect(rect, size(), area(), { minZoom: zoom, maxZoom: zoom, fill: 1 }), ms);
      };
      if (motionRef.current) {
        await focus([winner.path[0]], 1200);
        for (let index = 0; index < winner.segments.length; index += 1) {
          if (session.cancelled) return;
          await focus([winner.segments[index].from, winner.segments[index].to], 900);
          setGoldCount(index + 1);
          await sleep(980);
        }
      }
      if (session.cancelled) return;
      setGoldCount(winner.path.length);
      setChampionCenter(true);
      if (motionRef.current) {
        setConfetti(true);
        await nextFrame();
        const canvas = confettiRef.current;
        if (canvas) {
          canvas.width = canvas.clientWidth || 1280;
          canvas.height = canvas.clientHeight || 720;
          session.particles.push(runParticles(canvas, { kind: "confetti", budget: 80 }));
          session.timers.push(window.setTimeout(() => { if (!session.cancelled) session.particles.push(runParticles(canvas, { kind: "confetti", budget: 60 })); }, 1100));
        }
      }
      await sleep(MOMENT_MS.championCard);
      if (session.cancelled) return;
      setChampionCenter(false);
      setConfetti(false);
      parkedRef.current?.();
      if (tour) await returnCamera();
    };

    const run = async () => {
      try {
        if (moment.type === "live") await runLive();
        else if (moment.type === "result") await runResult();
        else if (moment.type === "champion") await runChampion();
        else if (moment.type === "draw") await runDraw();
        else if (moment.type === "merge") await runMerge();
        else if (moment.type === "mark") await runMark();
      } finally {
        session.finished = true;
        if (!session.cancelled) finishRef.current?.(moment.id);
      }
    };
    run();
    return () => {
      session.cancelled = true;
      session.timers.forEach((timer) => window.clearTimeout(timer));
      session.frames.forEach((frame) => window.cancelAnimationFrame(frame));
      session.particles.forEach((layer) => layer.stop());
      // Nur ein abgebrochener Moment hält seine Fahrt an - die Rückfahrt nach dem Moment gehört schon dem Baum.
      if (!session.finished) cancelMove();
      setBanner(null);
      setCard(null);
      setRides(null);
      setChampionCenter(false);
      setConfetti(false);
      setMarks(NO_MAP);
      setDrawRows(NO_MAP);
    };
    // Nur ein neuer Moment startet den Ablauf - neue Daten laufen über die Refs mit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [momentId]);

  const lastStage = lastStageId(matches, stages);
  const cardMatches = card ? card.ids.map((id) => matches.find((match) => match.id === id)).filter(Boolean) : [];
  const nameOf = nameOfRegistration(registrations);

  return (
    <div ref={viewportRef} className="tv-viewport" data-testid="tv-viewport" data-camera={moment ? "moment" : plan?.mode || "wait"} data-moment={moment?.type || undefined}>
      <div ref={stageRef} className="tv-tree-stage" style={treeCssVars(textSize)} data-testid="tv-tree-stage">
        <div ref={contentRef} className="tv-tree-content">
          <TvTreeContext.Provider value={treeValue}>
            <BracketTree data={data} viewMode="tv" nodeRenderer={TvTreeNode} tvLayout={tvLayout} />
          </TvTreeContext.Provider>
        </div>
        {content ? (
          <svg className="tv-tree-overlay" width={content.w} height={content.h} viewBox={`0 0 ${content.w} ${content.h}`} aria-hidden="true" data-testid="tv-tree-overlay">
            {goldPaths.map((path) => (
              <path key={path.id} d={path.d} pathLength="1" className="tv-gold-path" data-drawn={path.index < drawnGold ? "1" : undefined} data-testid="tv-gold-path" />
            ))}
            {(rides || []).map((ride) => (ride.kind === "drop" ? <path key={`d-${ride.id}`} d={routePath(ride.route)} className="tv-drop-line" data-tv-drop={ride.id} /> : null))}
            {(rides || []).map((ride) => (
              // Die Spur wächst vom Start bis zum Namen mit (strokeDashoffset 1 → 0), danach blendet sie aus.
              <path key={`t-${ride.id}`} d={routePath(ride.route)} pathLength="1" className={`tv-trail ${ride.kind === "drop" ? "tv-trail--drop" : ""}`} data-tv-trail={ride.id}
                style={{ strokeDasharray: "1 1", strokeDashoffset: 1, opacity: 0 }} />
            ))}
          </svg>
        ) : null}
        {(rides || []).map((ride) => (
          <div key={ride.id} className={`tv-rider ${ride.kind === "drop" ? "tv-rider--drop" : ""}`} data-tv-rider={ride.id} data-testid="tv-rider"
            style={{ transform: `translate(${ride.route.points[0].x}px, ${ride.route.points[0].y}px)`, opacity: 0 }}>
            <span className="tv-rider__face tv-t-meta">{ride.avatar ? <img src={resolveMediaUrl(ride.avatar)} alt="" /> : ride.label}</span>
          </div>
        ))}
      </div>
      {plan?.mode === "tour" ? <div className="tv-vignette" aria-hidden="true" /> : null}
      {banner ? <TvLiveBanner text={banner.text} kind={banner.kind} note={banner.note} /> : null}
      {card && cardMatches.length ? (
        <div className="tv-moment-layer">
          {card.many ? (
            <TvCollectiveCard matches={cardMatches} allMatches={matches} registrations={registrations} isLastStage={(match) => !lastStage || (match.stage_id || "__default") === lastStage} isTable={(match) => isTableFormat([match])} />
          ) : (
            <TvResultCard match={cardMatches[0]} matches={matches} registrations={registrations} lastStage={!lastStage || (cardMatches[0].stage_id || "__default") === lastStage} table={isTableFormat([cardMatches[0]])} tag={resultTags.get(cardMatches[0].id) || ""} />
          )}
        </div>
      ) : null}
      {champion && championCenter ? (
        <div className="tv-moment-layer">
          <TvChampionCard champion={champion} registrations={registrations} tournamentTitle={data?.tournament?.title || ""} />
        </div>
      ) : null}
      {confetti ? <canvas ref={confettiRef} className="tv-confetti" aria-hidden="true" data-testid="tv-confetti" /> : null}
      {champion && championParked && parkSpot && parkSpot !== "header" ? (
        <TvChampionCard champion={champion} registrations={registrations} parked spot={parkSpot} testId="tv-champion-parked" />
      ) : null}
      <span className="sr-only" aria-live="polite">{champion && championParked ? `Champion: ${nameOf(champion.winnerId)}` : ""}</span>
    </div>
  );
}
