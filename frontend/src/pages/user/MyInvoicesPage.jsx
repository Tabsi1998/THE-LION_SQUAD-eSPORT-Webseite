import { InvoicesPanel } from "./profile/InvoicesPanel";

// Rechnungen (#320, seit #2059 der erste Reiter von „Rechnungen & Unterlagen“ in „Mein Bereich“): die eine Stelle für die
// eigenen Belege - erreichbar aus Mails, Event- und Turnierseiten; /account/invoices und /profile?tab=invoices leiten
// hierher. Rechnungen gehören zum Konto, nicht zum Vereinsbereich - auch Nicht-Mitglieder bekommen hier ihre Belege.

export default function MyInvoicesPage() {
  return (
    <section className="min-w-0" data-testid="my-invoices">
      <InvoicesPanel />
    </section>
  );
}
