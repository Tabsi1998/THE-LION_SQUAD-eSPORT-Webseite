// Die Ebenen des Wetters für den gemeinsamen Canvas-Loop (#673): die Regen-Ebene hält die Tropfen je Tiefe, neigt sie
// nach Wind und Böen, hört auf das Wetter (mehr, weniger, vorbei - dann läuft der Regen aus, statt zu verschwinden),
// schiebt die Tropfen mit dem Scrollen (sie gehören zur Seite) und lässt einen Teil auf den Oberkanten von Karten,
// Rahmen und Fußzeile mit einem Spritzer landen. Die Wetter-Ebene darüber entscheidet je Bild, was gilt: in der
// Schnee-Saison nichts (dort wird Regen zu Schnee), sonst Regen oder leichter Schnee. Ohne Niederschlag meldet sie
// `idle` - dann schläft der Loop. Pausiert wird sie vom Loop (versteckter Tab).

import { hashString, mulberry32 } from "../rng";
import { measureAnchors } from "../anchors";
import { measureQuietZones, pointInQuiet } from "../quiet";
import { nextGust, windAt, windFrom } from "../snow/flakes";
import { createSnowLayer } from "../snow/layer";
import { requestMotion, releaseMotion } from "../motion";
import { RAIN_DEPTHS, RAIN_ORDER, advanceDrop, createDrop, createSplash, crossedEdge, driftOf, dropCounts, rainFactor, scrollDrop, splashPoints } from "./rain";
import { BOLT_ALPHA, GLOW_ALPHA, GLOW_REACH, createFlash, flashDone, flashLevel, isThunderstorm, nextFlashAt } from "./storm";

export const EDGE_REFRESH_MS = 900;
export const MAX_SPLASHES = 40;
/** Schnee außerhalb der Schnee-Saison bleibt leicht. */
export const OFF_SEASON_SNOW = 0.6;
const COLOR = "200, 225, 245";

/** Die Oberkanten im Fenster, auf denen Tropfen landen können (Fensterkoordinaten) - nicht in Ruhezonen. */
export function measureEdges(doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const zones = measureQuietZones(doc, win);
  const scrollX = (win && win.scrollX) || 0;
  const scrollY = (win && win.scrollY) || 0;
  return measureAnchors(doc, win, { kinds: ["card", "frame", "footer"], minSize: { card: [90, 40], frame: [90, 40], footer: [200, 60] }, limits: { card: 40, frame: 40 }, inViewMargin: 0 })
    .filter((anchor) => !pointInQuiet({ x: anchor.rect.left + scrollX + 8, y: anchor.rect.top + scrollY + 8 }, zones, { fixed: false }))
    .map((anchor) => ({ x1: anchor.rect.left + 6, x2: anchor.rect.right - 6, y: anchor.rect.top, key: anchor.key }));
}

/** Läuft gerade die Schnee-Saison? Die Bühne schreibt die laufenden Saisonen an das <html>. */
export function snowSeasonActive(doc = typeof document === "undefined" ? null : document) {
  const value = doc && doc.documentElement && doc.documentElement.dataset ? doc.documentElement.dataset.season : "";
  return String(value || "").split(" ").includes("snow");
}

/**
 * Die Regen-Ebene. `budget` (Gerät, Stärke) und `share` (Seitenklasse) bestimmen die Zahl, `weather` Menge, Wind und
 * Nacht; `setActive(false)` lässt den Regen auslaufen. `win`, `measure` und `now` sind für Tests austauschbar.
 */
export function createRainLayer({ budget = 120, share = 1, seed = "rain", weather = null, win = typeof window === "undefined" ? null : window, measure = () => measureEdges(), now = () => Date.now() } = {}) {
  const rng = mulberry32(hashString(`rain:${seed}`));
  const state = { t: 0, wind: windFrom(weather), rain: rainFactor(weather), active: true, night: Boolean(weather && weather.night), gust: nextGust(rng, 0), drops: { back: [], mid: [], front: [] }, splashes: [], counts: null, lastCount: -1e9, edges: [], edgesAt: -1e9 };
  let lastScrollY = win ? Number(win.scrollY) || 0 : 0;
  const factor = () => (state.active ? state.rain : 0);
  const total = () => RAIN_ORDER.reduce((sum, depth) => sum + state.drops[depth].length, 0);
  const onWeather = (event) => {
    const detail = event && event.detail;
    if (!detail) return;
    state.wind = windFrom(detail);
    state.rain = rainFactor(detail);
    state.night = Boolean(detail.night);
    state.lastCount = -1e9;
  };
  if (win && typeof win.addEventListener === "function") win.addEventListener("tls:season-weather", onWeather);

  const settle = (size, first) => {
    const counts = dropCounts(budget, { share, factor: factor(), night: state.night });
    state.counts = counts;
    RAIN_ORDER.forEach((depth) => {
      const list = state.drops[depth];
      const staying = list.filter((drop) => !drop.leaving);
      // Weniger Regen: die Überzähligen fallen noch zu Ende. Mehr Regen: neue kommen von oben.
      staying.slice(counts[depth]).forEach((drop) => {
        drop.leaving = true;
      });
      for (let n = staying.length; n < counts[depth]; n += 1) list.push(createDrop(depth, size, rng, { anywhere: first }));
    });
  };

  return {
    key: "weather-rain",
    draw(ctx, dt, size) {
      state.t += dt;
      if (state.t - state.lastCount > 3) {
        settle(size, state.lastCount < -1e8 && state.t <= dt);
        state.lastCount = state.t;
      }
      if (factor() <= 0 && total() === 0 && state.splashes.length === 0) return;
      if (state.t > state.gust.at + state.gust.length + 4) state.gust = nextGust(rng, state.t);
      const wind = windAt(state.t, state.wind, state.gust);
      const scrollY = win ? Number(win.scrollY) || 0 : 0;
      const scrolled = scrollY - lastScrollY;
      lastScrollY = scrollY;
      const stamp = now();
      if (scrolled || stamp - state.edgesAt > EDGE_REFRESH_MS) {
        state.edges = measure();
        state.edgesAt = stamp;
      }
      ctx.save();
      ctx.lineCap = "round";
      RAIN_ORDER.forEach((depth) => {
        const list = state.drops[depth];
        ctx.lineWidth = RAIN_DEPTHS[depth].width;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const drop = list[i];
          if (scrolled) scrollDrop(drop, scrolled, size, rng);
          const previousY = advanceDrop(drop, dt, wind, size, rng);
          if (drop.done) {
            list.splice(i, 1);
            continue;
          }
          const edge = crossedEdge(drop, previousY, state.edges);
          if (edge) {
            if (state.splashes.length < MAX_SPLASHES) state.splashes.push(createSplash(drop.x, edge.y, rng));
            if (drop.leaving) {
              list.splice(i, 1);
              continue;
            }
            drop.y = size.height + drop.length + 1;
            advanceDrop(drop, 0, wind, size, rng);
            continue;
          }
          if (drop.y < -40 || drop.y - drop.length > size.height) continue;
          const slant = (driftOf(drop, wind) / drop.speed) * drop.length;
          ctx.strokeStyle = `rgba(${COLOR}, ${drop.alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(drop.x - slant, drop.y - drop.length);
          ctx.lineTo(drop.x, drop.y);
          ctx.stroke();
        }
      });
      for (let i = state.splashes.length - 1; i >= 0; i -= 1) {
        const splash = state.splashes[i];
        splash.age += dt;
        const points = splashPoints(splash);
        if (!points.length) {
          state.splashes.splice(i, 1);
          continue;
        }
        points.forEach((point) => {
          ctx.fillStyle = `rgba(${COLOR}, ${point.alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.restore();
    },
    /** Regnen lassen oder auslaufen lassen (Schnee-Saison, es schneit statt zu regnen). */
    setActive(active) {
      if (Boolean(active) === state.active) return;
      state.active = Boolean(active);
      state.lastCount = -1e9;
    },
    /** Nichts zu zeichnen: kein Regen und kein Tropfen mehr im Bild. */
    idle() {
      return factor() <= 0 && total() === 0 && state.splashes.length === 0;
    },
    dispose() {
      if (win && typeof win.removeEventListener === "function") win.removeEventListener("tls:season-weather", onWeather);
      state.splashes.length = 0;
    },
    /** Nur für Tests. */
    state() {
      return {
        t: state.t,
        wind: state.wind,
        factor: factor(),
        active: state.active,
        night: state.night,
        counts: state.counts,
        edges: state.edges,
        splashes: state.splashes.length,
        drops: Object.fromEntries(RAIN_ORDER.map((depth) => [depth, state.drops[depth].length])),
        positions: Object.fromEntries(RAIN_ORDER.map((depth) => [depth, state.drops[depth].map((drop) => ({ x: drop.x, y: drop.y, leaving: Boolean(drop.leaving) }))])),
      };
    },
  };
}

/**
 * Die Wetter-Ebene der Saison „Wetter“: Regen, oder leichter Schnee, oder - in der Schnee-Saison und ohne
 * Niederschlag - nichts. Entscheidet je Bild neu, damit ein Wetterwechsel ohne Neuaufbau ankommt.
 */
export function createWeatherLayer({ budget = 120, share = 1, seed = "weather", weather = null, win = typeof window === "undefined" ? null : window, doc = typeof document === "undefined" ? null : document, measure = () => measureEdges(), now = () => Date.now(), request = requestMotion, release = releaseMotion } = {}) {
  const rng = mulberry32(hashString(`storm:${seed}`));
  let latest = weather;
  let snow = null;
  let clock = 0;
  const storm = { flash: null, token: null, nextAt: nextFlashAt(rng, 0), count: 0 };
  const rain = createRainLayer({ budget, share, seed, weather, win, measure, now });
  const onWeather = (event) => {
    if (event && event.detail) latest = event.detail;
  };
  if (win && typeof win.addEventListener === "function") win.addEventListener("tls:season-weather", onWeather);
  const mode = () => {
    if (snowSeasonActive(doc) || !latest || latest.stale) return "none";
    if (Number(latest.snow_cm) > 0) return "snow";
    if (Number(latest.rain_mm) > 0) return "rain";
    return "none";
  };
  // Gewitter nur außerhalb der Schnee-Saison und nur auf lebendigen und mittleren Seiten (dort ist `share` ≥ 0,6).
  const thunder = () => !snowSeasonActive(doc) && isThunderstorm(latest);
  // Der Himmel beginnt unter der Kopfzeile, solange sie oben klebt - Schein und Blitz kommen hinter ihr hervor.
  const skyTop = () => {
    const header = doc && typeof doc.querySelector === "function" ? doc.querySelector("header") : null;
    const rect = header && typeof header.getBoundingClientRect === "function" ? header.getBoundingClientRect() : null;
    return rect && rect.top <= 0 && rect.bottom > 0 && rect.bottom < 200 ? rect.bottom : 0;
  };
  const drawFlash = (ctx, size) => {
    const level = flashLevel(storm.flash, clock);
    if (level <= 0) return;
    const top = storm.flash.top || 0;
    const reach = size.height * GLOW_REACH;
    // Ein breiter, flacher Schein, der an seinem Rand ganz ausläuft (keine Kante): Kreisverlauf, in die Breite gezogen.
    const stretch = Math.max(1, (size.width * 0.75) / reach);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    glow.addColorStop(0, `rgba(215, 230, 255, ${(GLOW_ALPHA * level).toFixed(3)})`);
    glow.addColorStop(0.5, `rgba(190, 210, 250, ${(GLOW_ALPHA * level * 0.45).toFixed(3)})`);
    glow.addColorStop(1, "rgba(190, 210, 250, 0)");
    ctx.save();
    ctx.save();
    ctx.translate(storm.flash.x, top);
    ctx.scale(stretch, 1);
    ctx.fillStyle = glow;
    ctx.fillRect(-reach, 0, reach * 2, reach);
    ctx.restore();
    if (storm.flash.bolt) {
      ctx.strokeStyle = `rgba(235, 242, 255, ${(BOLT_ALPHA * level).toFixed(3)})`;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      [[storm.flash.bolt.main, 1.4], ...storm.flash.bolt.branches.map((branch) => [branch, 0.8])].forEach(([points, width]) => {
        ctx.lineWidth = width;
        ctx.beginPath();
        points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
        ctx.stroke();
      });
    }
    ctx.restore();
  };
  return {
    key: "weather",
    draw(ctx, dt, size) {
      clock += dt;
      const current = mode();
      rain.setActive(current === "rain");
      if (current === "snow" && !snow) snow = createSnowLayer({ budget: Math.round(budget * OFF_SEASON_SNOW), share, seed, weather: latest, win, doc, baseFactor: 0 });
      if (snow) {
        snow.setActive(current === "snow");
        snow.draw(ctx, dt, size);
        if (current !== "snow" && snow.idle()) {
          snow.dispose();
          snow = null;
        }
      }
      // Wetterleuchten: selten, kurz, im Bewegungsbudget (versteckter Tab, Anlauf und Abklingzeit gelten).
      if (storm.flash && flashDone(storm.flash, clock)) {
        release(storm.token);
        storm.flash = null;
        storm.token = null;
        storm.nextAt = nextFlashAt(rng, clock);
      }
      if (!storm.flash && thunder() && clock >= storm.nextAt) {
        storm.token = request("lightning");
        if (storm.token) {
          storm.flash = createFlash(rng, size, clock, skyTop());
          storm.count += 1;
        } else storm.nextAt = clock + 3;
      }
      if (storm.flash) drawFlash(ctx, size);
      rain.draw(ctx, dt, size);
    },
    /** Nichts zu zeichnen - der Loop darf schlafen (bei Gewitter nur, solange der nächste Blitz noch fern ist). */
    idle() {
      if (storm.flash) return false;
      if (thunder() && storm.nextAt - clock < 2.5) return false;
      return mode() === "none" && rain.idle() && (!snow || snow.idle());
    },
    /** Der Loop hat geschlafen: die Uhr der Ebene läuft trotzdem weiter. */
    slept(seconds) {
      clock += Math.max(0, Number(seconds) || 0);
    },
    dispose() {
      if (win && typeof win.removeEventListener === "function") win.removeEventListener("tls:season-weather", onWeather);
      release(storm.token);
      rain.dispose();
      if (snow) snow.dispose();
      snow = null;
    },
    /** Nur für Tests. */
    state() {
      return { mode: mode(), thunder: thunder(), clock, flashes: storm.count, flashing: Boolean(storm.flash), nextFlashAt: storm.nextAt, rain: rain.state(), snow: snow ? snow.state() : null };
    },
  };
}
