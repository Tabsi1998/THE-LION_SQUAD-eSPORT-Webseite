import { useEffect, useRef, useState } from "react";

const MAX_SAMPLE_SIDE = 520;
const MAX_CANVAS_SIDE = 1200;

function detectContentBox(image) {
  const sourceW = image.naturalWidth || image.width;
  const sourceH = image.naturalHeight || image.height;
  if (!sourceW || !sourceH) return null;

  const scale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(sourceW, sourceH));
  const sampleW = Math.max(1, Math.round(sourceW * scale));
  const sampleH = Math.max(1, Math.round(sourceH * scale));
  const sample = document.createElement("canvas");
  sample.width = sampleW;
  sample.height = sampleH;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

  const pixelAt = (x, y) => {
    const i = (y * sampleW + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const corners = [
    pixelAt(0, 0),
    pixelAt(sampleW - 1, 0),
    pixelAt(0, sampleH - 1),
    pixelAt(sampleW - 1, sampleH - 1),
  ];
  const bg = corners.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2], acc[3] + p[3]], [0, 0, 0, 0]).map((v) => v / corners.length);

  let minX = sampleW;
  let minY = sampleH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sampleH; y += 1) {
    for (let x = 0; x < sampleW; x += 1) {
      const i = (y * sampleW + x) * 4;
      const a = data[i + 3];
      if (a <= 8) continue;
      const delta = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) + Math.abs(a - bg[3]);
      if (a < 244 || delta > 44) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w >= sampleW * 0.96 && h >= sampleH * 0.96) return null;

  const pad = Math.max(3, Math.round(Math.max(w, h) * 0.07));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(sampleW - 1, maxX + pad);
  maxY = Math.min(sampleH - 1, maxY + pad);

  return {
    sx: minX / scale,
    sy: minY / scale,
    sw: (maxX - minX + 1) / scale,
    sh: (maxY - minY + 1) / scale,
  };
}

export function SmartLogo({ src, alt = "", className = "", fallbackClassName = "" }) {
  const canvasRef = useRef(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!src) return undefined;
    let cancelled = false;
    setFallback(false);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const sourceW = image.naturalWidth || image.width;
        const sourceH = image.naturalHeight || image.height;
        const box = detectContentBox(image) || { sx: 0, sy: 0, sw: sourceW, sh: sourceH };
        const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(box.sw, box.sh));
        canvas.width = Math.max(1, Math.round(box.sw * scale));
        canvas.height = Math.max(1, Math.round(box.sh * scale));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, box.sx, box.sy, box.sw, box.sh, 0, 0, canvas.width, canvas.height);
      } catch {
        setFallback(true);
      }
    };
    image.onerror = () => {
      if (!cancelled) setFallback(true);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;
  if (fallback) {
    return <img src={src} alt={alt} loading="lazy" decoding="async" className={fallbackClassName || className} />;
  }
  return <canvas ref={canvasRef} role={alt ? "img" : undefined} aria-label={alt || undefined} className={`block ${className}`} />;
}
