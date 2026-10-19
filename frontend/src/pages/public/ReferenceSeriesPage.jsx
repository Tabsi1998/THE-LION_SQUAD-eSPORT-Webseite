import { NotFoundPage } from "@/pages/ErrorPages";

// Seite einer Serie unter /references/series/<spur>/<saison> (Entscheidung 5 zu #1741). Die Adresse steht seit dem
// Datenmodell im Routen-Gerüst; die Seite selbst kommt mit #1745 (Turnierserie), #1746 (Rennliga) und #1747 (Team-Liga).
// Bis dahin gibt es sie nicht - wie jede unbekannte Adresse: 404, nicht indexiert.
export default function ReferenceSeriesPage() {
  return <NotFoundPage />;
}
