import { useEffect, useRef, useState } from "react";

// QR-Scanner für den Einlass (#845): Kamera nach hinten; das eingebaute Erkennen des Browsers, wo es das gibt (Chrome,
// Android), sonst jsQR (iPhone, Firefox) - erst geladen, wenn der Scanner läuft. Ohne Kamera oder ohne Erlaubnis steht
// der Grund da; der Einlass geht dann über die Mitgliedsnummer. Derselbe Code wird erst nach vier Sekunden wieder gemeldet.

const SAME_CODE_MS = 4000;
const STATE_TEXTS = {
  starting: "Kamera startet …",
  denied: "Die Kamera ist nicht erlaubt – im Browser erlauben oder die Mitgliedsnummer eintippen.",
  unavailable: "Keine Kamera verfügbar – bitte die Mitgliedsnummer eintippen.",
};

async function makeDecoder() {
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => (await detector.detect(video))[0]?.rawValue || "";
      }
    } catch {
      // weiter mit jsQR
    }
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height || !context) return "";
    const scale = Math.min(1, 640 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data || "";
  };
}

export function QrScanner({ onCode, paused = false }) {
  const videoRef = useRef(null);
  const pausedRef = useRef(paused);
  const onCodeRef = useRef(onCode);
  const lastRef = useRef({ code: "", at: 0 });
  const [state, setState] = useState("starting");

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (error) {
        setState(error?.name === "NotAllowedError" ? "denied" : "unavailable");
        return;
      }
      const video = videoRef.current;
      if (stopped || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      const decode = await makeDecoder();
      if (stopped) return;
      setState("running");
      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current && video.readyState >= 2) {
          const code = await decode(video).catch(() => "");
          const now = Date.now();
          if (code && !(code === lastRef.current.code && now - lastRef.current.at < SAME_CODE_MS)) {
            lastRef.current = { code, at: now };
            onCodeRef.current(code);
          }
        }
        timer = setTimeout(tick, 250);
      };
      tick();
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-sm border border-white/10 bg-black aspect-square sm:aspect-video" data-testid="qr-scanner">
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline aria-label="Kamerabild zum Scannen der Mitgliedskarte" />
      {state === "running" ? (
        <div className="pointer-events-none absolute inset-[18%] border-2 border-[#29B6E8]/70 rounded-sm" aria-hidden="true" />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70" data-testid="qr-scanner-state">{STATE_TEXTS[state]}</div>
      )}
    </div>
  );
}
