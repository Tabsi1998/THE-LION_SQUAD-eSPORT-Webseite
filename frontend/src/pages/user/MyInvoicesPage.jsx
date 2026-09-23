import { Link } from "react-router-dom";
import { ArrowLeft, Receipt } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { InvoicesPanel } from "./profile/InvoicesPanel";

// /account/invoices: dieselbe Tafel wie im Profil-Reiter „Rechnungen“ (#320) – als eigene Seite für
// Links aus Mails, Event- und Turnierseiten. Rechnungen gehören zum Konto, deshalb geht es von hier
// zurück ins Profil, nicht in den Mitgliederbereich.

export default function MyInvoicesPage() {
  useDocumentTitle("Meine Rechnungen", "Deine Rechnungen und Belege aus der Mitgliederverwaltung.", { robots: "noindex, nofollow" });
  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/profile?tab=invoices" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#FFD700]">
          <ArrowLeft className="w-3.5 h-3.5" /> Mein Profil
        </Link>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-6 inline-flex items-center gap-3"><Receipt className="w-7 h-7 text-[#FFD700]" /> Meine Rechnungen</h1>
        <InvoicesPanel />
      </section>
    </PublicLayout>
  );
}
