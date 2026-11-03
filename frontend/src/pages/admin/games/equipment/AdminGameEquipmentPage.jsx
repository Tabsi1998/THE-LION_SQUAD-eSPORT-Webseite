// Ausrüstung eines Spiels (#2218) unter /admin/games/<id>/equipment - vorläufiger Rahmen um EquipmentLibrary. Sobald die Spielseite mit
// Reitern (#2249) steht, sitzt die Bibliothek dort als Reiter „Ausrüstung“; diese Adresse leitet dann weiter.
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { EquipmentLibrary } from "./EquipmentLibrary";

export default function AdminGameEquipmentPage() {
  const { gameId } = useParams();
  const [game, setGame] = useState(null);
  const onGame = useCallback((value) => setGame(value), []);
  return (
    <AdminLayout>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link to="/admin/games" data-testid="equipment-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]">
          <ArrowLeft className="h-3.5 w-3.5" /> Spiele
        </Link>
        <Link to={`/admin/games/${gameId}/maps`} className="text-xs font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]">Maps</Link>
      </div>
      <h1 className="mt-3 mb-5 font-heading text-3xl font-black uppercase break-words md:text-4xl" data-testid="equipment-title">
        Ausrüstung{game?.name ? ` · ${game.name}` : ""}
      </h1>
      <EquipmentLibrary gameId={gameId} onGame={onGame} />
    </AdminLayout>
  );
}
