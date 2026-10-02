import { hashString, mulberry32 } from "@/seasons/rng";

// Das Bild des Adventkalenders (#641, #732): eine Winternacht über einem Tiroler Dorf - Sterne, das Sternbild
// Löwe, Nordlicht, Mond, zwei Bergketten, Tannen, Häuser mit warmen Fenstern, Schnee und die Spur einer großen
// Tatze, die zum Dorf führt. Das Bild ist hoch gebaut und am Boden verankert: am PC (6 × 4) sieht man Dorf und
// Berge mit einem Streifen Himmel, am Handy (3 × 8) den ganzen Himmel darüber. Die Türchen sind aus diesem einen
// Bild geschnitten. Alles kommt aus der Saat des Jahres: nächstes Jahr stehen Sterne, Bäume und Lichter anders.

export const SCENE = { width: 1200, height: 3200, ground: 3030 };

const f = (value) => (Math.round(value * 10) / 10).toString();

function between(rng, min, max) {
  return min + rng() * (max - min);
}

/** Ein Bergkamm als Punkte: grobe Gipfel, dazwischen kleine Zacken. */
export function ridgePoints(rng, { base, height, peaks, jag = 0.22 }) {
  const points = [];
  const step = SCENE.width / (peaks * 2);
  for (let i = 0; i <= peaks * 2; i += 1) {
    const peak = i % 2 === 1;
    const x = Math.min(SCENE.width, Math.max(0, i * step + (i === 0 || i === peaks * 2 ? 0 : between(rng, -step * 0.28, step * 0.28))));
    const y = peak ? base - height * between(rng, 0.55, 1) : base - height * between(rng, 0.05, 0.3);
    points.push({ x, y, peak });
    if (i < peaks * 2) {
      const nx = x + step * between(rng, 0.35, 0.65);
      points.push({ x: Math.min(SCENE.width, nx), y: y + (peak ? 1 : -1) * height * jag * between(rng, 0.4, 1), peak: false });
    }
  }
  return points.sort((a, b) => a.x - b.x);
}

function ridgePath(points) {
  return `M0 ${SCENE.height} L${points.map((point) => `${f(point.x)} ${f(point.y)}`).join(" L")} L${SCENE.width} ${SCENE.height} Z`;
}

function snowCaps(points, height) {
  return points.filter((point) => point.peak).map((point) => {
    const w = height * 0.2;
    const d = height * 0.26;
    return `<path d="M${f(point.x)} ${f(point.y)} l${f(w)} ${f(d)} l${f(-w * 0.45)} ${f(-d * 0.3)} l${f(-w * 0.3)} ${f(d * 0.42)} l${f(-w * 0.4)} ${f(-d * 0.38)} l${f(-w * 0.55)} ${f(d * 0.3)} Z" fill="#e4ecff" opacity="0.5"/>`;
  }).join("");
}

function stars(rng, count) {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const y = between(rng, 0, 2860);
    const r = rng() < 0.85 ? between(rng, 0.7, 1.5) : between(rng, 1.6, 2.6);
    // Zum Horizont hin verblassen die Sterne im Dunst.
    const haze = y > 2300 ? 1 - (y - 2300) / 700 : 1;
    const tint = rng() < 0.2 ? "#ffe9c4" : rng() < 0.3 ? "#cfe0ff" : "#ffffff";
    out += `<circle cx="${f(between(rng, 0, SCENE.width))}" cy="${f(y)}" r="${f(r)}" fill="${tint}" opacity="${f(Math.max(0.12, between(rng, 0.35, 0.95) * haze))}"/>`;
  }
  return out;
}

function sparkles(rng, count) {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const x = between(rng, 40, SCENE.width - 40);
    const y = between(rng, 120, 2600);
    const s = between(rng, 5, 10);
    out += `<path d="M${f(x)} ${f(y - s)} Q${f(x + s * 0.12)} ${f(y - s * 0.12)} ${f(x + s)} ${f(y)} Q${f(x + s * 0.12)} ${f(y + s * 0.12)} ${f(x)} ${f(y + s)} Q${f(x - s * 0.12)} ${f(y + s * 0.12)} ${f(x - s)} ${f(y)} Q${f(x - s * 0.12)} ${f(y - s * 0.12)} ${f(x)} ${f(y - s)} Z" fill="#fff6dc" opacity="${f(between(rng, 0.5, 0.9))}"/>`;
  }
  return out;
}

// Das Sternbild Löwe: die Sichel (Kopf und Mähne) und das Dreieck (Rumpf) - als Gruß an den Verein.
const LEO = {
  stars: { regulus: [300, 1800, 3.6], eta: [332, 1706, 2.2], algieba: [404, 1642, 3], zeta: [436, 1560, 2.2], mu: [382, 1498, 2], epsilon: [318, 1522, 2.4], zosma: [612, 1676, 2.6], chertan: [604, 1762, 2.4], denebola: [716, 1756, 3.2] },
  lines: [["regulus", "eta"], ["eta", "algieba"], ["algieba", "zeta"], ["zeta", "mu"], ["mu", "epsilon"], ["algieba", "zosma"], ["zosma", "denebola"], ["denebola", "chertan"], ["chertan", "regulus"], ["zosma", "chertan"]],
};

function leo(dx, dy, scale) {
  const at = ([x, y]) => [300 + (x - 300) * scale + dx, 1800 + (y - 1800) * scale + dy];
  const lines = LEO.lines.map(([a, b]) => {
    const [x1, y1] = at(LEO.stars[a]);
    const [x2, y2] = at(LEO.stars[b]);
    return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }).join("");
  const points = Object.values(LEO.stars).map((star) => {
    const [x, y] = at(star);
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(star[2] * 3.2)}" fill="url(#a-star)"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(star[2])}" fill="#fff8e6"/>`;
  }).join("");
  return `<g data-part="leo"><g stroke="#cfe0ff" stroke-width="0.9" stroke-linecap="round" opacity="0.38">${lines}</g>${points}</g>`;
}

function aurora(rng, filters) {
  let out = "";
  for (let i = 0; i < 3; i += 1) {
    const y = 760 + i * 300 + between(rng, -60, 60);
    const bend = between(rng, 90, 190) * (i % 2 ? -1 : 1);
    const thick = between(rng, 150, 230);
    out += `<path d="M-60 ${f(y)} C 260 ${f(y - bend)}, 520 ${f(y + bend)}, 820 ${f(y - bend * 0.4)} S 1160 ${f(y + bend * 0.7)}, 1260 ${f(y - 40)} L1260 ${f(y - 40 + thick)} C 1080 ${f(y + bend * 0.7 + thick * 0.8)}, 900 ${f(y + thick)}, 640 ${f(y + bend * 0.5 + thick)} S 240 ${f(y - bend * 0.6 + thick)}, -60 ${f(y + thick * 0.9)} Z" fill="url(#a-aurora-${i % 2})" opacity="${f(between(rng, 0.13, 0.2))}"${filters ? ' filter="url(#a-blur-l)"' : ""}/>`;
  }
  return `<g data-part="aurora">${out}</g>`;
}

function moon(rng) {
  const x = between(rng, 820, 1010);
  const y = between(rng, 2400, 2500);
  const r = 56;
  return `<g data-part="moon"><circle cx="${f(x)}" cy="${f(y)}" r="210" fill="url(#a-halo)"/><circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#fdf4d8" mask="url(#a-crescent)"/>`
    + `<mask id="a-crescent"><rect width="1200" height="3200" fill="#000"/><circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#fff"/><circle cx="${f(x - 26)}" cy="${f(y - 12)}" r="${r - 4}" fill="#000"/></mask>`
    + `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#9fb4e6" opacity="0.07"/></g>`;
}

function fir(x, base, height, rng) {
  const w = height * between(rng, 0.34, 0.42);
  let out = `<rect x="${f(x - height * 0.03)}" y="${f(base - height * 0.12)}" width="${f(height * 0.06)}" height="${f(height * 0.14)}" fill="#0a1020"/>`;
  let snow = "";
  for (let tier = 0; tier < 4; tier += 1) {
    const top = base - height + (height * 0.2) * tier;
    const bottom = top + height * 0.4;
    const half = w * (0.42 + tier * 0.2);
    out += `<path d="M${f(x)} ${f(top)} L${f(x + half)} ${f(bottom)} Q${f(x)} ${f(bottom - height * 0.05)} ${f(x - half)} ${f(bottom)} Z" fill="#0b1328"/>`;
    snow += `<path d="M${f(x)} ${f(top)} L${f(x + half * 0.62)} ${f(top + (bottom - top) * 0.62)} Q${f(x + half * 0.2)} ${f(top + (bottom - top) * 0.45)} ${f(x - half * 0.1)} ${f(top + (bottom - top) * 0.6)} Q${f(x - half * 0.3)} ${f(top + (bottom - top) * 0.35)} ${f(x)} ${f(top)} Z" fill="#e8efff" opacity="0.5"/>`;
  }
  return out + snow;
}

function forest(rng, line) {
  let out = "";
  let x = between(rng, -10, 20);
  while (x < SCENE.width + 20) {
    // Wo das Dorf steht, bleibt der Wald licht.
    const inVillage = x > 590 && x < 1010;
    if (!inVillage || rng() < 0.22) out += fir(x, line(x) + 6, between(rng, inVillage ? 46 : 60, inVillage ? 70 : 118), rng);
    x += between(rng, 20, 44);
  }
  return `<g data-part="forest">${out}</g>`;
}

function house(x, ground, rng, lit) {
  const w = between(rng, 48, 72);
  const h = between(rng, 32, 46);
  const roof = between(rng, 22, 32);
  const wall = rng() < 0.5 ? "#1b2544" : "#232d50";
  let out = `<rect x="${f(x)}" y="${f(ground - h)}" width="${f(w)}" height="${f(h)}" fill="${wall}"/>`;
  out += `<path d="M${f(x - 6)} ${f(ground - h)} L${f(x + w / 2)} ${f(ground - h - roof)} L${f(x + w + 6)} ${f(ground - h)} Z" fill="#141c36"/>`;
  out += `<path d="M${f(x - 6)} ${f(ground - h)} L${f(x + w / 2)} ${f(ground - h - roof)} L${f(x + w + 6)} ${f(ground - h)} L${f(x + w - 2)} ${f(ground - h - 3)} L${f(x + w / 2)} ${f(ground - h - roof + 8)} L${f(x + 2)} ${f(ground - h - 3)} Z" fill="#eef3ff" opacity="0.92"/>`;
  const chimney = x + w * between(rng, 0.62, 0.78);
  out += `<rect x="${f(chimney)}" y="${f(ground - h - roof * 0.78)}" width="7" height="${f(roof * 0.5)}" fill="#11182e"/><rect x="${f(chimney - 1)}" y="${f(ground - h - roof * 0.78 - 3)}" width="9" height="3.4" rx="1.4" fill="#eef3ff" opacity="0.9"/>`;
  const windows = w > 60 ? 3 : 2;
  let glow = "";
  for (let i = 0; i < windows; i += 1) {
    const wx = x + (w / (windows + 1)) * (i + 1) - 4;
    const wy = ground - h * 0.68;
    const on = lit();
    out += `<rect x="${f(wx)}" y="${f(wy)}" width="8" height="10" rx="0.8" fill="${on ? "#ffc45e" : "#0d1428"}"/>`;
    if (on) {
      out += `<path d="M${f(wx + 4)} ${f(wy)} v10 M${f(wx)} ${f(wy + 5)} h8" stroke="#a9691c" stroke-width="0.8"/>`;
      glow += `<circle cx="${f(wx + 4)}" cy="${f(wy + 5)}" r="22" fill="url(#a-window)"/>`;
    }
  }
  return { body: out, glow, chimney: [chimney + 3.5, ground - h - roof * 0.78 - 3] };
}

function church(x, ground, rng) {
  const out = [
    `<rect x="${f(x)}" y="${f(ground - 58)}" width="58" height="58" fill="#1f294a"/>`,
    `<path d="M${f(x - 5)} ${f(ground - 58)} L${f(x + 29)} ${f(ground - 84)} L${f(x + 63)} ${f(ground - 58)} Z" fill="#141c36"/>`,
    `<path d="M${f(x - 5)} ${f(ground - 58)} L${f(x + 29)} ${f(ground - 84)} L${f(x + 63)} ${f(ground - 58)} L${f(x + 55)} ${f(ground - 61)} L${f(x + 29)} ${f(ground - 76)} L${f(x + 3)} ${f(ground - 61)} Z" fill="#eef3ff" opacity="0.92"/>`,
    `<rect x="${f(x + 58)}" y="${f(ground - 112)}" width="24" height="112" fill="#232d50"/>`,
    // Der spitze Helm, wie ihn die Kirchen im Inntal tragen - die Wetterseite liegt im Schnee.
    `<path d="M${f(x + 55)} ${f(ground - 112)} L${f(x + 70)} ${f(ground - 186)} L${f(x + 85)} ${f(ground - 112)} Z" fill="#141c36"/>`,
    `<path d="M${f(x + 55)} ${f(ground - 112)} L${f(x + 70)} ${f(ground - 186)} L${f(x + 73)} ${f(ground - 150)} L${f(x + 66)} ${f(ground - 126)} L${f(x + 62)} ${f(ground - 112)} Z" fill="#eef3ff" opacity="0.85"/>`,
    `<path d="M${f(x + 70)} ${f(ground - 186)} v-16 M${f(x + 65)} ${f(ground - 196)} h10" stroke="#e9c46a" stroke-width="1.6" stroke-linecap="round"/>`,
    `<circle cx="${f(x + 70)}" cy="${f(ground - 92)}" r="6.5" fill="#ffd98a"/><path d="M${f(x + 70)} ${f(ground - 92)} v-4 M${f(x + 70)} ${f(ground - 92)} h3" stroke="#6b4a16" stroke-width="0.9" stroke-linecap="round"/>`,
    `<path d="M${f(x + 66)} ${f(ground - 62)} q4 -9 8 0 v14 h-8 Z" fill="#ffc45e"/>`,
    `<path d="M${f(x + 12)} ${f(ground - 26)} q5 -12 10 0 v16 h-10 Z M${f(x + 34)} ${f(ground - 26)} q5 -12 10 0 v16 h-10 Z" fill="${rng() < 0.85 ? "#ffc45e" : "#0d1428"}"/>`,
  ].join("");
  const glow = `<circle cx="${f(x + 70)}" cy="${f(ground - 92)}" r="26" fill="url(#a-window)"/><circle cx="${f(x + 28)}" cy="${f(ground - 22)}" r="34" fill="url(#a-window)"/><circle cx="${f(x + 70)}" cy="${f(ground - 52)}" r="22" fill="url(#a-window)"/>`;
  return { body: out, glow };
}

function smoke(x, y, rng, filters) {
  const sway = between(rng, 14, 30) * (rng() < 0.5 ? -1 : 1);
  return `<path d="M${f(x)} ${f(y)} c ${f(sway)} -22, ${f(-sway)} -44, ${f(sway * 0.6)} -70 s ${f(-sway * 1.4)} -40, ${f(sway * 0.4)} -78" fill="none" stroke="#d6e0f8" stroke-width="${f(between(rng, 6, 9))}" stroke-linecap="round" opacity="0.16"${filters ? ' filter="url(#a-blur-s)"' : ""}/>`;
}

function village(rng, filters) {
  const ground = SCENE.ground;
  const lit = () => rng() < 0.72;
  const spots = [600, 668, 742, 902, 962].map((x) => x + between(rng, -8, 8));
  let bodies = "";
  let glows = "";
  let plumes = "";
  spots.forEach((x, index) => {
    const built = house(x, ground + between(rng, -4, 8), rng, lit);
    bodies += built.body;
    glows += built.glow;
    if (index % 2 === 0) plumes += smoke(built.chimney[0], built.chimney[1], rng, filters);
  });
  const tower = church(806, ground + 2, rng);
  return `<g data-part="village">${plumes}${glows}${tower.glow}${tower.body}${bodies}</g>`;
}

/** Eine Tatze im Schnee: Ballen und vier Zehen, in Laufrichtung gedreht. */
export function pawPrint(x, y, size, angle) {
  const toes = [[-7.4, -7.2, 2.7], [-2.7, -11.2, 2.9], [2.7, -11.2, 2.9], [7.4, -7.2, 2.7]].map(([tx, ty, tr]) => `<ellipse cx="${tx}" cy="${ty}" rx="${tr}" ry="${f(tr * 1.18)}"/>`).join("");
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${f(size)})"><path d="M0 -4.6 C 4.6 -4.6 8.2 -0.8 8 3.4 C 7.8 6.6 4.2 7.4 0 7.4 C -4.2 7.4 -7.8 6.6 -8 3.4 C -8.2 -0.8 -4.6 -4.6 0 -4.6 Z"/>${toes}</g>`;
}

function pawTrail() {
  // Von vorne links ins Dorf: die Spur wird mit der Entfernung kleiner und enger.
  let out = "";
  const steps = 12;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const x = 96 + 470 * t + Math.sin(t * Math.PI * 1.4) * 46;
    const y = 3168 - 118 * Math.pow(t, 0.8);
    const next = { x: 96 + 470 * (t + 0.02) + Math.sin((t + 0.02) * Math.PI * 1.4) * 46, y: 3168 - 118 * Math.pow(t + 0.02, 0.8) };
    const heading = (Math.atan2(next.y - y, next.x - x) * 180) / Math.PI + 90;
    const size = 1.15 - t * 0.78;
    const side = i % 2 === 0 ? -1 : 1;
    const nx = Math.cos(((heading) * Math.PI) / 180) * 9 * size * side;
    const ny = Math.sin(((heading) * Math.PI) / 180) * 9 * size * side;
    out += pawPrint(x + nx, y + ny, size, heading + side * 7);
  }
  return `<g data-part="paws" fill="#6f86b8" opacity="0.5">${out}</g>`;
}

function snowfall(rng, count) {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += `<circle cx="${f(between(rng, 0, SCENE.width))}" cy="${f(between(rng, 2100, 3170))}" r="${f(between(rng, 0.9, 2.4))}" fill="#fff" opacity="${f(between(rng, 0.18, 0.6))}"/>`;
  }
  return `<g data-part="snowfall">${out}</g>`;
}

function hillLine(rng, base, swell) {
  const a = between(rng, 0.6, 1.4);
  const b = between(rng, 0, Math.PI * 2);
  return (x) => base - Math.sin((x / SCENE.width) * Math.PI * a + b) * swell - Math.sin((x / SCENE.width) * Math.PI * 3.1 + b * 2) * swell * 0.25;
}

function hillPath(line) {
  let d = `M0 ${SCENE.height} L0 ${f(line(0))}`;
  for (let x = 40; x <= SCENE.width; x += 40) d += ` L${x} ${f(line(x))}`;
  return `${d} L${SCENE.width} ${SCENE.height} Z`;
}

/**
 * Das ganze Bild als SVG-Text - dieselbe Saat, dasselbe Bild. Ohne `filters` kommt es ohne Weichzeichner aus
 * (Nordlicht und Rauch bleiben über ihre Durchsicht weich): so zeichnet es die App, die keine Filter kennt.
 */
export function sceneSvg(year, { filters = true } = {}) {
  const rng = mulberry32(hashString(`advent-scene:${year}`));
  const far = ridgePoints(rng, { base: 2860, height: 250, peaks: 5 });
  const mid = ridgePoints(rng, { base: 2950, height: 170, peaks: 6, jag: 0.16 });
  const woods = hillLine(rng, 3000, 16);
  const back = hillLine(rng, 3052, 12);
  const front = hillLine(rng, 3112, 20);
  const leoDx = between(rng, -40, 120);
  const leoDy = between(rng, -60, 60);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE.width} ${SCENE.height}" preserveAspectRatio="xMidYMax slice" data-year="${year}">`,
    "<defs>",
    '<linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03060f"/><stop offset="0.36" stop-color="#070e24"/><stop offset="0.62" stop-color="#0c1838"/><stop offset="0.8" stop-color="#14244c"/><stop offset="0.9" stop-color="#1f3563"/><stop offset="0.96" stop-color="#2f4b7a"/><stop offset="1" stop-color="#3a5786"/></linearGradient>',
    '<linearGradient id="a-aurora-0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5dffc0" stop-opacity="0"/><stop offset="0.35" stop-color="#5dffc0"/><stop offset="1" stop-color="#3fa0ff" stop-opacity="0"/></linearGradient>',
    '<linearGradient id="a-aurora-1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8affd8" stop-opacity="0"/><stop offset="0.4" stop-color="#57e0b0"/><stop offset="1" stop-color="#7a6bff" stop-opacity="0"/></linearGradient>',
    '<radialGradient id="a-halo"><stop offset="0" stop-color="#fff2c9" stop-opacity="0.42"/><stop offset="0.3" stop-color="#cfdcff" stop-opacity="0.16"/><stop offset="1" stop-color="#cfdcff" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="a-star"><stop offset="0" stop-color="#fff8e6" stop-opacity="0.55"/><stop offset="1" stop-color="#fff8e6" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="a-window"><stop offset="0" stop-color="#ffc45e" stop-opacity="0.42"/><stop offset="1" stop-color="#ffc45e" stop-opacity="0"/></radialGradient>',
    '<linearGradient id="a-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8fc"/><stop offset="1" stop-color="#9db1da"/></linearGradient>',
    '<linearGradient id="a-snow-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c9ec"/><stop offset="1" stop-color="#8197c6"/></linearGradient>',
    '<radialGradient id="a-vignette" cx="0.5" cy="0.62" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.42"/></radialGradient>',
    filters ? '<filter id="a-blur-l" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>' : "",
    filters ? '<filter id="a-blur-s" x="-60%" y="-20%" width="220%" height="140%"><feGaussianBlur stdDeviation="3.2"/></filter>' : "",
    "</defs>",
    `<rect width="${SCENE.width}" height="${SCENE.height}" fill="url(#a-sky)"/>`,
    aurora(rng, filters),
    `<g data-part="stars">${stars(rng, 320)}${sparkles(rng, 16)}</g>`,
    leo(leoDx, leoDy, 1),
    moon(rng),
    `<g data-part="mountains"><path d="${ridgePath(far)}" fill="#22335e"/>${snowCaps(far, 250)}<path d="${ridgePath(mid)}" fill="#172547"/>${snowCaps(mid, 170)}</g>`,
    `<path d="${hillPath(woods)}" fill="#0e1830"/>`,
    forest(rng, woods),
    `<path d="${hillPath(back)}" fill="url(#a-snow-back)"/>`,
    village(rng, filters),
    `<path d="${hillPath(front)}" fill="url(#a-snow)"/>`,
    pawTrail(),
    snowfall(rng, 130),
    `<rect width="${SCENE.width}" height="${SCENE.height}" fill="url(#a-vignette)"/>`,
    "</svg>",
  ].join("");
}

/** Das Bild als Adresse für CSS (`background-image`). */
export function sceneUrl(year) {
  return `url("data:image/svg+xml,${encodeURIComponent(sceneSvg(year))}")`;
}
