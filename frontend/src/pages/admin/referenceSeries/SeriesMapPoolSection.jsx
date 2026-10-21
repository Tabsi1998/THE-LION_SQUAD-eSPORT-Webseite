// Map-Pool der Saison (#1616), nur Vorstand: aus der Map-Bibliothek des Spiels der Spur, je Modus. Die Serienseite
// zeigt ihn mit Bildern; das Ergebnisblatt der Team-Liga wählt später daraus (#1931). Ohne Spiel der Spur bleibt der
// Freitext bei den Maps. Spätere Änderungen an der Bibliothek ändern den gespeicherten Pool nicht (Snapshot).
import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { MapPoolEditor } from "@/pages/admin/maps/MapPoolEditor";
import { toast } from "sonner";

export function SeriesMapPoolSection({ series }) {
  const [data, setData] = useState(null);
  const confirm = useConfirm();
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/map-pools/reference-series/${series.id}`);
      setData(body);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [series.id]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["map-pools", "games"]);

  if (!data) return null;
  const save = async (body) => {
    try {
      await api.put(`/map-pools/reference-series/${series.id}`, body);
      toast.success("Map-Pool der Saison gespeichert.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const clear = async () => {
    if (!await confirm({ title: "Map-Pool der Saison entfernen?", description: "Die Serienseite zeigt dann keine Maps mehr. Gespeicherte Ergebnisse bleiben, wie sie sind.", confirmLabel: "Entfernen" })) return false;
    try {
      await api.delete(`/map-pools/reference-series/${series.id}`);
      toast.success("Map-Pool entfernt.");
      await load();
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };
  const sources = data.previous
    ? [{ key: "previous", label: `Pool der Saison ${data.previous.source_season || "davor"}`, pool: data.previous }] : [];
  return (
    <MapPoolEditor
      key={data.pool?.id || "neu"}
      title="Map-Pool der Saison"
      hint="Die Maps, die in dieser Saison gespielt werden – je Modus aus der Bibliothek des Spiels. Die Serienseite zeigt sie mit Bild."
      game={data.game} library={data.library} entry={data.pool} sources={sources} libraryLink
      onSave={save} onClear={clear} testId="series-map-pool"
    />
  );
}
