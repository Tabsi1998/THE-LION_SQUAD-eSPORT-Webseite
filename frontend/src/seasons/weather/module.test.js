import { season, skyLayers } from "./module";
import { RAIN_BUDGET } from "./rain";

// Die Saison „Wetter“ (#673) gibt der Bühne genau eine Ebene: auf lebendigen Seiten alles, auf ruhigeren weniger, auf
// stillen nichts - außer in der Vorschau aus dem Admin, die sofort zu sehen sein soll. Nie bei „dezent“, „Bewegung
// reduzieren“ oder ohne Budget. Das Wetter ist nur Himmel.

const WEATHER = { key: "weather", effective: "normal" };
const RAIN = { rain_mm: 2.5, snow_cm: 0, code: 95, wind_factor: 1, wind_dir: 270, night: false };
const SIZE = { width: 1200, height: 800 };

function fakeContext() {
  return new Proxy({}, {
    get: (_target, name) => {
      if (["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha"].includes(name)) return "";
      if (name === "createRadialGradient") return () => ({ addColorStop: () => {} });
      return () => {};
    },
    set: () => true,
  });
}

function dropsOn(pathname, options = {}) {
  window.history.pushState({}, "", pathname);
  const layers = skyLayers({ season: WEATHER, budget: 100, weather: RAIN, ...options });
  if (!layers.length) return null;
  layers[0].draw(fakeContext(), 0.016, SIZE);
  const total = layers[0].state().rain.counts.total;
  layers.forEach((layer) => layer.dispose());
  return total;
}

afterEach(() => {
  window.history.pushState({}, "", "/");
  delete document.documentElement.dataset.season;
});

test("eine Ebene, nach der Seite bemessen: lebendig alles, ruhiger weniger, still nichts", () => {
  window.history.pushState({}, "", "/events");
  const layers = skyLayers({ season: WEATHER, budget: 100, weather: RAIN });
  expect(layers).toHaveLength(1);
  expect(layers[0].key).toBe("weather");
  expect(typeof layers[0].idle).toBe("function");
  layers[0].dispose();
  expect(dropsOn("/events")).toBe(Math.round(100 * RAIN_BUDGET));
  expect(dropsOn("/login")).toBe(Math.round(100 * RAIN_BUDGET * 0.6));
  expect(dropsOn("/admin/settings/jahreszeiten")).toBeNull();
  expect(dropsOn("/display/1")).toBeNull();
});

test("Vorschau: es regnet auch im Admin, und zwar so wie auf der Startseite", () => {
  expect(dropsOn("/admin/settings/jahreszeiten", { preview: true })).toBe(Math.round(100 * RAIN_BUDGET));
  expect(dropsOn("/login", { preview: true })).toBe(Math.round(100 * RAIN_BUDGET));
});

test("nie bei „dezent“, „Bewegung reduzieren“, ohne Budget oder ohne Saison - auch nicht in der Vorschau", () => {
  window.history.pushState({}, "", "/events");
  expect(skyLayers({ season: { ...WEATHER, effective: "subtle" }, budget: 100, weather: RAIN, preview: true })).toEqual([]);
  expect(skyLayers({ season: WEATHER, budget: 100, weather: RAIN, reducedMotion: true, preview: true })).toEqual([]);
  expect(skyLayers({ season: WEATHER, budget: 0, weather: RAIN })).toEqual([]);
  expect(skyLayers({ season: null, budget: 100, weather: RAIN })).toEqual([]);
});

test("nur Himmel: keine Ecken, kein Widget, kein Farbschein, kein Klang", () => {
  expect(season).toMatchObject({ key: "weather", skyOnly: true, skyLayers });
  ["Corners", "Widget", "Footer", "Toast", "Backdrop", "accent", "sounds"].forEach((part) => expect(season[part]).toBeUndefined());
});
