import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText, FolderOpen } from "lucide-react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { DocumentViewer } from "@/components/tls/DocumentViewer";
import { SkeletonList } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { CATEGORY_LABELS, DocumentGroup } from "./DocumentRows";

// /account/documents (#1255): die eigenen Unterlagen aus der Vereinsakte - Bestätigungen und Schreiben, die nur dich
// betreffen. Erreichbar über „Nur für dich“ im eigenen Profil; deshalb geht es von hier zurück ins Profil. Die
// Vereinsdokumente für alle (Statuten, Protokolle) stehen im Mitgliederbereich. Ansehen und Laden wie dort.

const FALLBACK = { available: false, reason: "error", text: "Deine Unterlagen konnten nicht geladen werden. Bitte später noch einmal versuchen.", documents: [] };

function emptyHeading(state) {
  if (state.available) return "Noch keine Unterlagen";
  return ["unreachable", "no_access", "error"].includes(state.reason) ? "Gerade nicht abrufbar" : "Keine Unterlagen";
}

export default function AccountDocumentsPage() {
  useDocumentTitle("Deine Unterlagen", "Deine persönlichen Unterlagen aus der Vereinsakte.", { robots: "noindex, nofollow" });
  const [state, setState] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(() => {
    api.get("/account/documents")
      .then(({ data }) => setState(data && typeof data === "object" ? data : FALLBACK))
      .catch(() => setState(FALLBACK));
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["documents", "account", "membership"]);

  const documents = Array.isArray(state?.documents) ? state.documents : [];
  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/u/me" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#FFD700]">
          <ArrowLeft className="w-3.5 h-3.5" /> Mein Profil
        </Link>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-6 flex items-center gap-3"><FileText className="w-7 h-7 shrink-0 text-[#FFD700]" aria-hidden="true" /> Deine Unterlagen</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Bestätigungen und Schreiben aus der Vereinsakte – nur für dich. Die Vereinsdokumente für alle (Statuten, Protokolle) stehen im{" "}
          <Link to="/members/documents" className="text-[#29B6E8] hover:underline">Mitgliederbereich</Link>.
        </p>

        {!state ? (
          <SkeletonList rows={3} className="mt-10" label="Lade deine Unterlagen" />
        ) : documents.length ? (
          <div className="mt-10" data-testid="account-documents-list">
            <DocumentGroup docs={documents} onView={setViewing} />
          </div>
        ) : (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-10 text-center text-white/60" data-testid="account-documents-empty" data-reason={state.reason || ""}>
            <FolderOpen className="w-10 h-10 mx-auto opacity-40 mb-3" aria-hidden="true" />
            <div className="font-heading font-bold text-lg text-white">{emptyHeading(state)}</div>
            <p className="mt-2 text-sm max-w-xl mx-auto">
              {state.reason === "not_bound"
                ? "Dein Konto ist noch nicht mit deinem Eintrag in der Vereinsakte verbunden. Das geht über die bestätigte E-Mail-Adresse, durch den Vorstand – oder mit einem Einladungscode unter „Meine Mitgliedschaft“."
                : state.text || "Bestätigungen und Schreiben vom Verein erscheinen hier, sobald der Vorstand sie in der Vereinsakte für dich ablegt."}
            </p>
            {state.reason === "not_bound" ? (
              <Link to="/members/membership" data-testid="account-documents-bind" className="tls-btn tls-btn--secondary mt-4 inline-flex px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Einladungscode einlösen</Link>
            ) : null}
          </div>
        )}
      </section>
      {viewing ? (
        <DocumentViewer
          path={`/documents/${viewing.id}/view`}
          downloadPath={viewing.allow_download ? `/documents/${viewing.id}/download` : null}
          title={viewing.title}
          subtitle={CATEGORY_LABELS[viewing.category] || viewing.category}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </PublicLayout>
  );
}
