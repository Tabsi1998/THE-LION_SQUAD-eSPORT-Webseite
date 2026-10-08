import { useEffect, useRef } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";

// Foto vom Ergebnis (#1157, #1158): ein Bild je Meldung - am Handy direkt mit der Kamera, sonst aus der Galerie oder
// vom PC. Das Foto wird sofort hochgeladen (der Server speichert es neu, ohne Ort und Kamera-Daten) und geht mit der
// Meldung mit. Sehen dürfen es nur die Gegenseite und die Turnierleitung - nach der Bildprüfung.

const ACCEPT = "image/png,image/jpeg,image/webp";

function uploadErrorText(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (error?.response?.status === 413) return "Das Bild ist zu groß.";
  return "Hochladen hat nicht geklappt.";
}

export function ProofPhotoPicker({ matchId, value = null, onChange, testId = "proof-photo" }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const previewRef = useRef(value?.previewUrl || null);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const pick = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewRef.current = previewUrl;
    onChange({ status: "uploading", previewUrl, name: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post(`/matches/${matchId}/proof-photos`, form);
      onChange({ status: "ready", previewUrl, id: data.id, scan_state: data.scan_state });
    } catch (error) {
      onChange({ status: "error", previewUrl, error: uploadErrorText(error) });
    }
  };

  const clear = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    onChange(null);
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Foto vom Ergebnis (freiwillig)</div>
      {value ? (
        <div className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-2">
          <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-white/5">
            {value.previewUrl ? <img src={value.previewUrl} alt="Foto vom Ergebnis" className="h-full w-full object-cover" /> : null}
            {value.status === "uploading" ? <span className="absolute inset-0 flex items-center justify-center bg-black/50"><Loader2 className="w-5 h-5 animate-spin text-white" /></span> : null}
          </div>
          <div className="min-w-0 flex-1 text-xs" data-testid={`${testId}-state`}>
            {value.status === "error" ? <span className="text-[#FF6B60]">{value.error}</span> : value.status === "uploading" ? <span className="text-white/60">Wird hochgeladen …</span> : (
              <span className="text-white/70">Foto angehängt – sehen nur die Gegenseite und die Turnierleitung.</span>
            )}
          </div>
          <button type="button" onClick={clear} aria-label="Foto entfernen" className="shrink-0 p-2 text-white/50 hover:text-white" data-testid={`${testId}-remove`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => cameraRef.current?.click()} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold md:hidden" data-testid={`${testId}-camera`}>
            <Camera className="w-4 h-4" /> Foto aufnehmen
          </button>
          <button type="button" onClick={() => galleryRef.current?.click()} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid={`${testId}-gallery`}>
            <ImagePlus className="w-4 h-4" /> Bild wählen
          </button>
        </div>
      )}
      <input ref={cameraRef} type="file" accept={ACCEPT} capture="environment" className="hidden" onChange={(event) => { pick(event.target.files); event.target.value = ""; }} data-testid={`${testId}-camera-input`} />
      <input ref={galleryRef} type="file" accept={ACCEPT} className="hidden" onChange={(event) => { pick(event.target.files); event.target.value = ""; }} data-testid={`${testId}-input`} />
    </div>
  );
}
