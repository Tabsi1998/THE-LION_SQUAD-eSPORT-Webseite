const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Kurze Schleifen für die FAQ (#2448): je Schritt eine stumme Bewegung wie ein GIF (Klick → Ergebnis), PC und Handy,
// als WebM (VP9) und MP4 (H.264). Aufgenommen wird die echte Seite über die Bildschirm-Übertragung von Chromium
// (CDP Page.startScreencast, Zeitstempel je Bild), danach schneidet ffmpeg den Ausschnitt des Standbilds heraus.
// Das Standbild (Poster) entsteht im selben Moment wie das letzte Bild der Schleife - Größe und Inhalt passen also.
// Nur mit HILFE_CLIPS=1; ohne laufen dieselben Handgriffe als normaler Test (docs/entwicklung/hilfe-bilder.md).

const CLIPS = process.env.HILFE_CLIPS === "1";
// Grenze je Datei - gleich lautend im Wächtertest src/hilfe/index.test.js (CLIP_MAX_BYTES).
const MAX_BYTES = 300 * 1024;
const FPS = 15;
const MIN_SECONDS = 2;
const MAX_SECONDS = 6;
// Ruhe am Anfang, Halten am Ende (mit Rahmen), Überblendung zurück zum ersten Bild - so läuft die Schleife ohne Sprung.
const LEAD_MS = 600;
const HOLD_MS = 1500;
const XFADE = 0.4;
const RING_COLOR = "#FFD23F";

const HIDE_CSS = `
  [data-sonner-toaster], [data-testid='bottom-nav'], [data-testid='scroll-top-btn'] { display: none !important; }
  [data-hilfe-leiste] { visibility: hidden !important; }
  #hilfe-punkt { position: fixed; z-index: 2147483647; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
    border: 2px solid ${RING_COLOR}; background: rgba(255,210,63,0.45); box-shadow: 0 0 0 3px rgba(0,0,0,0.45);
    pointer-events: none; left: -60px; top: -60px; opacity: 0;
    transition: opacity 160ms ease-out, transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
  #hilfe-punkt[data-zeigen='1'] { opacity: 1; }
  #hilfe-punkt[data-druck='1'] { transform: scale(0.72); }
  #hilfe-markierung > div { opacity: 0; transition: opacity 220ms cubic-bezier(0.23, 1, 0.32, 1); }
  #hilfe-markierung[data-an='1'] > div { opacity: 1; }
`;

function ffmpegPath() {
  return process.env.FFMPEG || "ffmpeg";
}

/** Fehlt ffmpeg, bricht die Aufnahme mit klarer Meldung ab (kein stiller Rückfall). */
function requireFfmpeg() {
  try {
    execFileSync(ffmpegPath(), ["-hide_banner", "-version"], { stdio: "ignore" });
  } catch {
    throw new Error("ffmpeg fehlt: für HILFE_CLIPS=1 muss ffmpeg im PATH liegen (oder FFMPEG=<pfad>).");
  }
}

/** Leisten, die oben kleben (Kopfzeile, Unterleisten), unsichtbar machen - ohne dass die Seite springt. */
async function hideBars(page, keepBars) {
  await page.addStyleTag({ content: HIDE_CSS });
  if (keepBars) return;
  await page.evaluate(() => {
    for (const node of document.querySelectorAll("header, nav, div")) {
      const style = getComputedStyle(node);
      if (style.position !== "sticky" && style.position !== "fixed") continue;
      const rect = node.getBoundingClientRect();
      if (rect.top <= 1 && rect.bottom > 0 && rect.height < 200 && rect.width > window.innerWidth / 2) node.setAttribute("data-hilfe-leiste", "1");
    }
  });
}

async function showBars(page) {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll("[data-hilfe-leiste]")) node.removeAttribute("data-hilfe-leiste");
    document.getElementById("hilfe-punkt")?.remove();
    document.getElementById("hilfe-markierung")?.remove();
  });
}

/** Der Tipp-Punkt: am PC gleitet er zum Ziel, am Handy erscheint er dort (wie ein Finger). */
async function dot(page, x, y, { show, press } = {}) {
  await page.evaluate(({ x: left, y: top, show: visible, press: down }) => {
    let node = document.getElementById("hilfe-punkt");
    if (!node) {
      node = document.createElement("div");
      node.id = "hilfe-punkt";
      document.body.appendChild(node);
    }
    if (left !== null) { node.style.left = `${left}px`; node.style.top = `${top}px`; }
    if (visible !== undefined) node.dataset.zeigen = visible ? "1" : "0";
    if (down !== undefined) node.dataset.druck = down ? "1" : "0";
  }, { x: x ?? null, y: y ?? null, show, press });
}

/**
 * Die Handgriffe einer Schleife. Ohne Aufnahme sind es schlichte Klicks und Eingaben (der Ablauf bleibt ein Test);
 * mit Aufnahme sieht man den Punkt zum Ziel wandern, tippen und Text Zeichen für Zeichen erscheinen.
 */
function actions(page, form, recording) {
  const state = { x: null, y: null };
  async function point(locator) {
    if (!recording) return;
    await locator.scrollIntoViewIfNeeded();
    let box = await locator.boundingBox();
    // Versteckte Kästchen (Häkchen im eigenen Look): auf die Beschriftung zeigen.
    if (!box || box.width < 4 || box.height < 4) box = await locator.locator("xpath=ancestor::label[1]").boundingBox().catch(() => null);
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (form === "pc" && state.x !== null) {
      // Gleiten mit echten Mausbewegungen (Hover-Zustände inklusive), der Punkt folgt.
      const steps = 10;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const ease = 1 - (1 - t) ** 3;
        const nx = state.x + (x - state.x) * ease;
        const ny = state.y + (y - state.y) * ease;
        await page.mouse.move(nx, ny);
        await dot(page, nx, ny, { show: true });
        await page.waitForTimeout(28);
      }
    } else {
      await page.mouse.move(x, y);
      await dot(page, x, y, { show: true });
      await page.waitForTimeout(260);
    }
    state.x = x;
    state.y = y;
    await dot(page, null, null, { press: true });
    await page.waitForTimeout(140);
    await dot(page, null, null, { press: false });
  }
  async function after() {
    if (!recording) return;
    await page.waitForTimeout(form === "pc" ? 380 : 220);
    if (form === "handy") await dot(page, null, null, { show: false });
    await page.waitForTimeout(form === "pc" ? 0 : 260);
  }
  return {
    async click(locator) {
      await point(locator);
      await locator.click();
      await after();
    },
    async check(locator) {
      await point(locator);
      await locator.check();
      await after();
    },
    async select(locator, value) {
      await point(locator);
      await locator.selectOption(value);
      await after();
    },
    /** Text eintippen: mit Aufnahme sichtbar Zeichen für Zeichen, sonst `fill`. */
    async type(locator, text, { delay = 55 } = {}) {
      if (!recording) {
        await locator.fill(text);
        return;
      }
      await point(locator);
      await locator.click();
      await locator.fill("");
      // Erst der Tipp, dann tippen: Am Handy ist der Punkt beim Schreiben schon weg.
      await after();
      await page.keyboard.type(text, { delay });
      await page.waitForTimeout(250);
    },
    async pause(ms) {
      if (recording) await page.waitForTimeout(ms);
    },
  };
}

/**
 * Bildfolge in voller Auflösung (deviceScaleFactor): Die Bildschirm-Übertragung von Chromium liefert ohne Fenster nur
 * 1x, das Poster hat am Handy 2x. Deshalb holt eine Schleife nebenher Bild um Bild (JPEG, auf Tempo gestellt) und
 * merkt sich die Zeit - die Abstände werden im Video genau so lang.
 */
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const view = page.viewportSize();
  const scale = await page.evaluate(() => window.devicePixelRatio || 1);
  let running = true;
  const loop = (async () => {
    while (running) {
      const time = Date.now() / 1000;
      try {
        // Der Ausschnitt zählt in Seiten-Koordinaten: das sichtbare Fenster an der aktuellen Scroll-Stelle.
        const { result } = await cdp.send("Runtime.evaluate", { expression: "[window.scrollX, window.scrollY]", returnByValue: true });
        const [x, y] = result.value;
        const clip = { x, y, width: view.width, height: view.height, scale };
        const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true, clip });
        if (running) frames.push({ data: Buffer.from(data, "base64"), time, scrollX: x, scrollY: y });
      } catch {
        break;
      }
      await new Promise((resolve) => { setTimeout(resolve, 1000 / (FPS * 2)); });
    }
  })();
  return {
    frames,
    async stop() {
      if (!running) return;
      running = false;
      await loop;
      await cdp.detach().catch(() => {});
    },
  };
}

/**
 * Bilder → Schleife. Ausschnitt in CSS-Pixeln (`clip`) wird auf die Auflösung der Bilder umgerechnet; am Ende blendet
 * die Schleife ins erste Bild über. Zu groß → stärker komprimieren; bleibt es zu groß, schlägt die Aufnahme fehl.
 */
function encode({ frames, endTime, clip, viewWidth, outBase }) {
  if (frames.length < 2) throw new Error(`${outBase}: zu wenige Bilder aufgenommen (${frames.length}).`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hilfe-clip-"));
  try {
    const list = [];
    frames.forEach((frame, index) => {
      const name = `f${String(index).padStart(5, "0")}.jpg`;
      fs.writeFileSync(path.join(tmp, name), frame.data);
      const next = index + 1 < frames.length ? frames[index + 1].time : endTime;
      list.push(`file '${name}'`, `duration ${Math.max(0.001, next - frame.time).toFixed(4)}`);
    });
    // Der Concat-Leser braucht das letzte Bild noch einmal, sonst gilt dessen Dauer nicht.
    list.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
    fs.writeFileSync(path.join(tmp, "liste.txt"), list.join("\n"));
    const total = endTime - frames[0].time;
    // Zu lang: schneller abspielen statt abschneiden (die Bewegung bleibt ganz).
    const speed = total > MAX_SECONDS ? MAX_SECONDS / total : 1;
    const length = total * speed;
    if (length < MIN_SECONDS) throw new Error(`${outBase}: nur ${length.toFixed(1)} s - mindestens ${MIN_SECONDS} s.`);
    const factor = `iw/${viewWidth}`;
    const crop = `crop=w='trunc(${clip.width}*${factor}/2)*2':h='trunc(${clip.height}*${factor}/2)*2':x='${clip.x}*${factor}':y='${clip.y}*${factor}'`;
    const prep = `${crop},fps=${FPS},format=yuv420p,setsar=1,settb=AVTB`;
    const filter = `[0:v]setpts=PTS*${speed.toFixed(4)},${prep}[a];[1:v]${prep}[b];[a][b]xfade=transition=fade:duration=${XFADE}:offset=${(length - XFADE).toFixed(3)},format=yuv420p[v]`;
    const inputs = ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "liste.txt"),
      "-loop", "1", "-framerate", String(FPS), "-t", String(XFADE + 0.2), "-i", path.join(tmp, "f00000.jpg"), "-filter_complex", filter, "-map", "[v]", "-an", "-pix_fmt", "yuv420p"];
    const sizes = {};
    for (const [ext, codec] of [["webm", "vp9"], ["mp4", "h264"]]) {
      const file = `${outBase}.${ext}`;
      let crf = codec === "vp9" ? 42 : 30;
      for (let attempt = 0; ; attempt += 1) {
        const args = codec === "vp9"
          ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-g", String(FPS * 10)]
          : ["-c:v", "libx264", "-preset", "veryslow", "-crf", String(crf), "-profile:v", "high", "-movflags", "+faststart", "-g", String(FPS * 10)];
        execFileSync(ffmpegPath(), [...inputs, ...args, "-t", length.toFixed(3), file], { stdio: ["ignore", "ignore", "pipe"] });
        sizes[ext] = fs.statSync(file).size;
        if (sizes[ext] <= MAX_BYTES) break;
        if (attempt >= 3) throw new Error(`${file}: ${sizes[ext]} Bytes - über ${MAX_BYTES} auch mit crf ${crf}. Ausschnitt verkleinern oder kürzen.`);
        crf += codec === "vp9" ? 5 : 3;
      }
    }
    return { length, sizes };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { CLIPS, FPS, HOLD_MS, LEAD_MS, MAX_BYTES, MAX_SECONDS, MIN_SECONDS, actions, encode, hideBars, requireFfmpeg, showBars, startScreencast };
