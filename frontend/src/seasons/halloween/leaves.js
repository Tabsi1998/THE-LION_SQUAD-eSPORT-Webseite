// Herbstblätter (#658): wenige Blätter taumeln langsam durchs Bild - Tirol im Oktober, ruhig, nicht kindlich.
// Reine Logik für den gemeinsamen Canvas-Loop.

export const LEAF_COLORS = ["rgba(176, 88, 30, 0.82)", "rgba(140, 70, 24, 0.8)", "rgba(196, 122, 40, 0.75)", "rgba(120, 58, 26, 0.85)"];

export function createLeaves(size, count, rng = Math.random) {
  return Array.from({ length: count }, () => spawnLeaf(size, rng, true));
}

export function spawnLeaf(size, rng, anywhere = false) {
  return {
    x: rng() * size.width,
    y: anywhere ? rng() * size.height : -30,
    size: 9 + rng() * 9,
    angle: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 1.6,
    fall: 14 + rng() * 14,
    drift: (rng() - 0.5) * 18,
    phase: rng() * Math.PI * 2,
    color: LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)],
  };
}

/** Blätter um dt Sekunden weiterbewegen; wer unten raus ist, kommt oben neu (seltener als er fällt: nur jedes zweite Mal). */
export function advanceLeaves(leaves, dt, size, rng = Math.random, wind = 0) {
  leaves.forEach((leaf, index) => {
    leaf.y += leaf.fall * dt;
    leaf.x += (leaf.drift + Math.sin(leaf.phase + leaf.y / 40) * 12 + wind) * dt;
    leaf.angle += leaf.spin * dt;
    if (leaf.y > size.height + 30 || leaf.x < -60 || leaf.x > size.width + 60) {
      leaves[index] = spawnLeaf(size, rng);
    }
  });
  return leaves;
}

/** Ein Blatt: zwei Bögen mit Mittelrippe, in Fallrichtung gedreht. */
export function drawLeaf(ctx, leaf) {
  const s = leaf.size;
  ctx.save();
  ctx.translate(leaf.x, leaf.y);
  ctx.rotate(leaf.angle);
  ctx.fillStyle = leaf.color;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
  ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.lineTo(0, s * 0.9);
  ctx.stroke();
  ctx.restore();
}
