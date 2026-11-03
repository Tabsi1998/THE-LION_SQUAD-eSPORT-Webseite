// Zustand einer Map ändern (#2207): aktiv, inaktiv, archiviert. Eigenständig - braucht Spiel, Map und einen Rückruf. Vor dem
// Deaktivieren oder Archivieren fragt sie, wo die Map gerade gilt, und nennt betroffene Seasons. Das ist eine Warnung, keine Sperre.
import { Archive, ArchiveRestore, CirclePause, CirclePlay } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { mapStatusOf } from "@/lib/mapPools";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-25 disabled:hover:text-white/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const DONE = { active: "Map aktiviert.", inactive: "Map deaktiviert.", archived: "Map archiviert." };
const WHAT = {
  inactive: "Inaktiv heißt: in keinen neuen Pool wählbar. Wo sie schon steht, bleibt sie gültig.",
  archived: "Archiviert heißt: in keinen Pool mehr wählbar und in der Bibliothek ausgeblendet. Gespeicherte Pools und Spiele zeigen sie weiter.",
};

/** Der Text der Rückfrage: was der Zustand heißt und, falls nötig, wo die Map gerade gilt. */
export function statusQuestion(item, status, seasons) {
  const where = (seasons || []).map((row) => `${row.league_name} ${row.season_name} (${row.status_text})`).join(", ");
  const warning = where ? ` Achtung: Sie steht im Map-Pool von ${where}. Der Pool gilt unverändert weiter – zum Sperren dort „Map aus dem Pool nehmen“.` : "";
  return `${WHAT[status] || ""}${warning}`.trim();
}

export function useMapStatus(gameId, onChanged) {
  const confirm = useConfirm();
  return async (item, status) => {
    try {
      if (status !== "active") {
        const { data: usage } = await api.get(`/games/${gameId}/maps/${item.id}/usage`);
        const ok = await confirm({
          title: `„${item.name}“ ${status === "inactive" ? "deaktivieren" : "archivieren"}?`,
          description: statusQuestion(item, status, usage.affected_seasons),
          confirmLabel: status === "inactive" ? "Deaktivieren" : "Archivieren",
        });
        if (!ok) return false;
      }
      const { data } = await api.patch(`/games/${gameId}/maps/${item.id}`, { status });
      toast.success(DONE[status]);
      if (data.warning) toast.warning(data.warning);
      await onChanged?.();
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };
}

export function MapStatusActions({ gameId, item, onChanged, testId = "game-map" }) {
  const change = useMapStatus(gameId, onChanged);
  const status = mapStatusOf(item);
  if (status === "archived") {
    return (
      <button type="button" className={ICON_BUTTON} onClick={() => change(item, "active")} aria-label={`${item.name} zurückholen`}
        data-testid={`${testId}-archive-${item.slug}`}>
        <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  }
  const inactive = status === "inactive";
  return (
    <>
      <button type="button" className={ICON_BUTTON} onClick={() => change(item, inactive ? "active" : "inactive")}
        aria-label={inactive ? `${item.name} aktivieren` : `${item.name} deaktivieren`} title={inactive ? "Aktivieren" : "Deaktivieren"}
        data-testid={`${testId}-status-${item.slug}`}>
        {inactive ? <CirclePlay className="w-4 h-4" aria-hidden="true" /> : <CirclePause className="w-4 h-4" aria-hidden="true" />}
      </button>
      <button type="button" className={ICON_BUTTON} onClick={() => change(item, "archived")} aria-label={`${item.name} archivieren`}
        data-testid={`${testId}-archive-${item.slug}`}>
        <Archive className="w-4 h-4" aria-hidden="true" />
      </button>
    </>
  );
}
