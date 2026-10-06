import { useEffect } from "react";
import { motionAllowed } from "@/lib/motion";

// Leichtes 3D (#1078): die große Karte im Profilkopf neigt sich nach der Mausposition, höchstens `maxDegrees`.
// Nur mit Maus (pointer: fine), nie am Handy, nicht mit „Bewegung reduzieren“. Die Neigung steht als CSS-Variablen
// am Element (--tls-tilt-x/-y in Grad, --tls-tilt-on 0/1), das CSS macht daraus die Drehung und die Tiefe der Teile.

export function tiltFor(x, y, width, height, maxDegrees = 3) {
  if (!width || !height) return { x: 0, y: 0 };
  const dx = Math.min(1, Math.max(0, x / width)) - 0.5;
  const dy = Math.min(1, Math.max(0, y / height)) - 0.5;
  // `+ 0` macht aus -0 eine 0 - sonst stünde „-0deg“ im Stil.
  return { x: Math.round(-dy * 2 * maxDegrees * 100) / 100 + 0, y: Math.round(dx * 2 * maxDegrees * 100) / 100 + 0 };
}

export function useTilt(ref, { maxDegrees = 3, enabled = true } = {}) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    if (!motionAllowed() || !window.matchMedia("(pointer: fine)").matches) return undefined;
    const move = (event) => {
      const box = node.getBoundingClientRect();
      const tilt = tiltFor(event.clientX - box.left, event.clientY - box.top, box.width, box.height, maxDegrees);
      node.style.setProperty("--tls-tilt-x", `${tilt.x}deg`);
      node.style.setProperty("--tls-tilt-y", `${tilt.y}deg`);
      node.style.setProperty("--tls-tilt-on", "1");
    };
    const leave = () => {
      node.style.setProperty("--tls-tilt-x", "0deg");
      node.style.setProperty("--tls-tilt-y", "0deg");
      node.style.setProperty("--tls-tilt-on", "0");
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
    };
  }, [ref, maxDegrees, enabled]);
}
