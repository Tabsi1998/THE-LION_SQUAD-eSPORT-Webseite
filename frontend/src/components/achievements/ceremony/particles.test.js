import { MAX_PARTICLES, MAX_PARTICLES_MOBILE, drawParticles, particleCap, runParticles, spawnParticles, stepParticles } from "./particles";

// Partikel-Ebene (E8): Budget 160 / 60 am Handy, Bewegung nur über Zeit, Zeichnen im Canvas, Pause bei
// verstecktem Tab, sauberes Aufräumen.

describe("particles", () => {
  it("hält das Budget je Fensterbreite", () => {
    expect(particleCap(1440, 500)).toBe(MAX_PARTICLES);
    expect(particleCap(390, 500)).toBe(MAX_PARTICLES_MOBILE);
    expect(particleCap(1440, 42)).toBe(42);
  });

  it("erzeugt, bewegt und entfernt Teilchen", () => {
    let seed = 1;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const spawned = spawnParticles({ kind: "prism", count: 30, width: 800, height: 600, rng });
    expect(spawned).toHaveLength(30);
    expect(new Set(spawned.map((p) => p.color)).size).toBeGreaterThan(1);
    const moved = stepParticles(spawned.map((p) => ({ ...p })), 0.1, { width: 800, height: 600 });
    expect(moved.length).toBeLessThanOrEqual(30);
    expect(moved.some((p, i) => p.x !== spawned[i]?.x || p.y !== spawned[i]?.y)).toBe(true);
    const gone = stepParticles(spawned.map((p) => ({ ...p, life: 10 })), 0.1, {});
    expect(gone).toHaveLength(0);
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), ellipse: vi.fn(), arc: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1, fillStyle: "" };
    drawParticles(ctx, [...spawnParticles({ kind: "confetti", count: 2, rng }), ...spawnParticles({ kind: "leaf", count: 1, rng }), ...spawnParticles({ kind: "flame", count: 1, rng })], 800, 600);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.ellipse).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
  });

  it("läuft über requestAnimationFrame, pausiert bei verstecktem Tab und räumt auf", () => {
    const frames = [];
    const win = { requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; }, cancelAnimationFrame: vi.fn(), performance: { now: () => 0 } };
    const doc = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), ellipse: vi.fn(), arc: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn() };
    const canvas = { width: 800, height: 600, getContext: () => ctx };
    const run = runParticles(canvas, { kind: "confetti", budget: 20, win, doc });
    expect(run.count()).toBe(20);
    frames[0](16);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    doc.hidden = true;
    frames[1](32);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    run.stop();
    expect(win.cancelAnimationFrame).toHaveBeenCalled();
    expect(doc.removeEventListener).toHaveBeenCalled();
    expect(runParticles({ getContext: () => null }, {}).count()).toBe(0);
  });
});
