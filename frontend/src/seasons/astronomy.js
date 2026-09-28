// Himmel nach Uhrzeit und Ort (#681): wo der Mond gerade steht - Höhe über dem Horizont und Kompassrichtung -
// für einen Ort (Breite/Länge) und einen Zeitpunkt. Die Näherung folgt Meeus („Astronomical Algorithms“) in der
// kompakten Form, die auch SunCalc (BSD) verwendet: Rechnung in Tagen seit J2000, ekliptikale Länge/Breite des
// Mondes mit den größten Störtermen, daraus Rektaszension und Deklination, über die Sternzeit in Höhe und Azimut.
// Genau genug für einen Mond am Seitenhimmel (Fehler unter einem Grad), ohne Paket.

const RAD = Math.PI / 180;
const OBLIQUITY = RAD * 23.4397;
const J2000 = 2451545;

/** Tage seit J2000 (2000-01-01 12:00 UTC). */
export function toDays(date) {
  return date.getTime() / 86400000 - 0.5 + 2440588 - J2000;
}

function rightAscension(l, b) {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
}

function declination(l, b) {
  return Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
}

function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

function azimuthFromSouth(H, phi, dec) {
  return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
}

function altitudeOf(H, phi, dec) {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}

/** Atmosphärische Hebung nahe dem Horizont (Bogenmaß). */
function refraction(h) {
  const clamped = h < 0 ? 0 : h;
  return 0.0002967 / Math.tan(clamped + 0.00312536 / (clamped + 0.08901179));
}

/** Rektaszension, Deklination und Entfernung (km) des Mondes für Tage seit J2000. */
export function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist };
}

/**
 * Mondstand für Ort und Zeit: `altitude` in Grad über dem Horizont (negativ = unter dem Horizont), `azimuth` als
 * Kompassrichtung in Grad (0 Nord, 90 Ost, 180 Süd, 270 West), `distance` in km.
 */
export function moonPosition(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitudeOf(H, phi, c.dec);
  h += refraction(h);
  const azimuth = (azimuthFromSouth(H, phi, c.dec) / RAD + 180 + 360) % 360;
  return { altitude: h / RAD, azimuth, distance: c.dist };
}

/** Nächster Auf- oder Untergang ab `date` (Minutenraster, höchstens `hours` voraus) - {at, rising}. */
export function nextMoonEvent(date, lat, lon, hours = 26) {
  let previous = moonPosition(date, lat, lon).altitude;
  for (let minute = 1; minute <= hours * 60; minute += 1) {
    const at = new Date(date.getTime() + minute * 60000);
    const altitude = moonPosition(at, lat, lon).altitude;
    if ((previous < 0) !== (altitude < 0)) return { at, rising: altitude >= 0 };
    previous = altitude;
  }
  return null;
}

/**
 * Die Himmelskuppel als Fläche über der Seite: Osten links, Süden Mitte, Westen rechts; der Horizont liegt bei
 * `horizon` (Anteil der Höhe von oben), 60° und mehr knapp unter der Kopfzeile bei `top`. Unter dem Horizont: nicht
 * sichtbar. Nahe dem Horizont wirkt der Mond größer und wärmer (Mondtäuschung).
 */
export function skyPlacement({ altitude, azimuth }, { width, height }, { horizon = 0.86, top = 0.12, edge = 0.06 } = {}) {
  const visible = altitude > -1.5;
  // Azimut 60°…300° auf die Breite legen (Ost → West über den Süden); weiter nördlich bleibt es am Rand.
  const span = Math.max(60, Math.min(300, azimuth));
  const x = width * (edge + ((span - 60) / 240) * (1 - edge * 2));
  const climb = Math.max(0, Math.min(1, altitude / 60));
  const y = height * (horizon - (horizon - top) * climb);
  const nearHorizon = Math.max(0, 1 - Math.max(0, altitude) / 30);
  return { visible, x, y, scale: 1 + 0.25 * nearHorizon, warmth: nearHorizon };
}
