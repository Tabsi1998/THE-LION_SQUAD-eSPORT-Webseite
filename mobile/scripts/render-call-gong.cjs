#!/usr/bin/env node
// Aufruf-Gong (#1138): der Ton des Android-Kanals „Aufrufe & Spielstart“. Android spielt den Ton eines Kanals aus einer
// Datei der App (res/raw) und ändert ihn nach dem Anlegen nie mehr - deshalb liegt der Gong als fertige WAV-Datei im
// Repo und kommt über das expo-notifications-Plugin (app.json → "sounds") in die App.
//
// Derselbe Gong wie am TV (frontend/src/lib/tvGong.js): C5 mit zwei leisen Obertönen, klingt in gut 2,5 Sekunden aus.
// Für das Handy lauter gemacht (Spitze 0,6). Neu erzeugen: `node scripts/render-call-gong.cjs` im Ordner mobile/.
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 22050;
const NOTE = 523.25;
const PARTIALS = [[1, 0.16], [2.01, 0.05], [2.76, 0.028]];
const SECONDS = 2.6;
const ATTACK = 0.015;
const LEAD = 0.01;
const PEAK = 0.6;
const OUT = path.join(__dirname, "..", "assets", "sounds", "lion_call_gong.wav");

/** Der Gong als Proben zwischen -1 und 1 - die Verläufe wie AudioParam.exponentialRampToValueAtTime. */
function render() {
  const length = Math.ceil((LEAD + SECONDS + 0.05) * SAMPLE_RATE);
  const samples = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE - LEAD;
    if (t < 0) continue;
    let value = 0;
    for (const [ratio, level] of PARTIALS) {
      let gain = 0;
      if (t <= ATTACK) gain = 0.0001 * Math.pow(level / 0.0001, t / ATTACK);
      else if (t <= SECONDS) gain = level * Math.pow(0.0001 / level, (t - ATTACK) / (SECONDS - ATTACK));
      value += gain * Math.sin(2 * Math.PI * NOTE * ratio * t);
    }
    samples[index] = value;
  }
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  const scale = max > 0 ? PEAK / max : 1;
  return samples.map((sample) => sample * scale);
}

/** Eine WAV-Datei: 16 Bit, mono. */
function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    data.writeInt16LE(Math.round(clamped * 32767), index * 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, encodeWav(render()));
  console.log(`Gong geschrieben: ${path.relative(process.cwd(), OUT)}`);
}

module.exports = { OUT, SAMPLE_RATE, SECONDS, encodeWav, render };
