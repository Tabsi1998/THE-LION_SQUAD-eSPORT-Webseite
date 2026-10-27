# Vereinsshop

Stand: Fundament aus #1703 (Datenmodell) und #1704 (Rechte, Protokoll), Teil des Epics #1699. Der Shop ist **von
außen unsichtbar**: Es gibt keine öffentlichen Routen, keine Seiten für Mitglieder und keinen Menüeintrag. Printful
(#1705), Konfiguration und Betriebsarten (#1706), Steuer (#1701) und die Shop-Seiten (#1712 ff.) folgen.

Code: `backend/services/shop_common.py` (Fehler, Anschriften, Protokoll, personenbezogene Felder),
`shop_catalog.py` (Katalog), `shop_orders.py` (Bestellungen, Ereignisse, Warenkorb), `shop_schema.py` (Indizes,
Migration 13), `backend/routes/shop_admin_routes.py` (Adminbereich), `backend/scripts/shop_schema.py` (Werkzeug).

## Datenmodell

**Schreibzugriffe nur über die Services.** Routen und andere Services rufen `shop_catalog` und `shop_orders`, nie
die Sammlungen direkt. Jede Katalogänderung ist eine Adminaktion mit Person und Grund.

| Sammlung | Inhalt | Eindeutig |
| --- | --- | --- |
| `shop_products` | Produkt: Slug, Titel, Beschreibung, Stand (`draft`, `active`, `archived`), Sichtbarkeit (`hidden`, `members`, `public`), Grundpreis und Vereinsaufschlag in Cent, Gamertag erlaubt, Steuerprofil (Referenz), aktuelle Druckdatei (`design_key`), `version` | `slug` |
| `shop_variants` | Variante eines Produkts: SKU, Bezeichnung, Größe, Farbe, eigener Preis (sonst der des Produkts), aktiv, `version` | `sku` |
| `shop_designs` | Druckdatei des Vereins je Fassung: `design_key`, `version` (zählt hoch), `file_ref`, `sha256`, Druckposition. Alte Fassungen bleiben | `design_key` + `version` |
| `shop_printful_variants` | Zuordnung Variante → Printful-Variante und -Produkt (Anbieter `printful`) | `provider` + `variant_id` |
| `shop_carts` | Warenkorb je Konto: Variante, Menge, Gamertag – keine Preise | `user_id` |
| `shop_orders` | Bestellung mit allem Eingefrorenen (unten), Stand, Rechnungs- und Lieferanschrift, `printful_external_id` | `idempotency_key`, `printful_external_id` |
| `shop_order_items` | Position einer Bestellung, eingefroren | `order_id` + `position` |
| `shop_order_events` | Verlauf einer Bestellung, **nur angehängt** | `order_id` + `event_key` |

Sichere Vorgaben: Ein neues Produkt ist `draft` und `hidden`, ohne Steuerprofil. Beträge sind ganze Cent, nie
negativ, mit Obergrenzen (Preis 1000 €, Aufschlag 100 €, Versand 100 €, Menge 20 je Position, 20 Positionen).
Unbekannte Felder lehnen Service und Route ab.

### Was eine Bestellung einfriert

`place_order` liest den Katalog genau einmal und schreibt alles in die Bestellung. Eine spätere Änderung an Produkt,
Variante, Druckdatei, Printful-Zuordnung, Profil oder Dolibarr wirkt nie zurück.

- `frozen`: Währung, Summe der Artikel, Vereinsaufschlag (nur bei öffentlichem Kauf, `buyer_kind = public`),
  Versand, Gesamtbetrag, **Steuerprofil** (nur die Referenz; mischen Positionen verschiedene, bleibt es `None`),
  Art des Kaufs, Zahlungsregeln der Bestellung (`payment_rules`, Felder für #1706: Dolibarr-Zahlungsbedingung,
  Erinnerungstage, Überfälligkeit, Stornoverfahren – ohne Vorgabe, ohne automatisches Storno).
- je Position: Produkt- und Variantenname, SKU, Menge, Einzelpreis, Aufschlag, Zeilensumme, **Gamertag** (nur
  Mitglieder bei Produkten mit Gamertag), **Druckdatei-Fassung** mit Prüfsumme, **Printful-Nummern**, Steuerprofil.
- `billing_address`: bestätigte Rechnungsanschrift (Name, Firma, Straße, PLZ, Ort, Land, optional die Nummer des
  Dolibarr-Geschäftspartners) mit `source` (`dolibarr`, `account`, `checkout`) und `confirmed_at`.
- `shipping_address`: Lieferanschrift mit Empfänger, **getrennt** von der Rechnungsanschrift, mit `source` und
  `captured_at`. Nur sie geht später an Printful (#1714, #1718).
- `printful_external_id = lsw-<Bestellung>`: darüber erkennt Printful einen wiederholten Auftrag (#1705).

Es wird **keine Steuer gerechnet**. Das Steuerprofil ist ein eingefrorenes Feld; die Rechenlogik kommt erst nach der
Klärung in #1701.

### Idempotenz

- Der Aufrufer gibt je Bestellversuch einen Schlüssel mit. Gespeichert wird `<konto>:<schlüssel>` – ein Schlüssel
  gilt nur für sein Konto. Derselbe Aufruf noch einmal liefert dieselbe Bestellung (`created = False`), ohne zweite
  Positionen und ohne zweites Ereignis. Derselbe Schlüssel mit anderem Inhalt ist ein Konflikt (`ShopConflict`).
- Zwei gleichzeitige Aufrufe: Der eindeutige Index entscheidet. Positionen werden vor der Bestellung geschrieben; wer
  das Rennen verliert, entfernt seine eigenen Positionen und liefert die Bestellung des Gewinners.
- Ereignisse mit festem `event_key` (etwa `placed`, später `payment.full`, `printful.confirmed`) gibt es je Bestellung
  höchstens einmal; wiederholbare Ereignisse bekommen einen neuen Schlüssel.

### Ereignisse

`append_event` ist der einzige Schreibweg; es gibt keine Funktion zum Ändern oder Löschen. Ein Ereignis trägt Art,
Zeitpunkt, wer es ausgelöst hat und Daten – **nie eine Anschrift** (der Service lehnt Adressfelder ab, auch
verschachtelt). Die Statusmaschine (#1716) baut darauf auf.

### Indizes, Migration, Rückweg

Die Indizes stehen in `database.AUDIT_UNIQUE_INDEXES` bzw. `AUDIT_INDEXES`: Jeder Start legt sie an, und die
Prüfung „Eindeutige Indizes“ unter **Betrieb → Checks** meldet einen fehlenden. Dubletten in Shop-Sammlungen
bereinigt `scripts/unique_index_duplicates.py` nie selbst (Regel `MANUAL`): Bestellungen, Positionen und Ereignisse
sind Nachweise, der Katalog ist eine Entscheidung der Finanzen. Nur doppelte Warenkörbe räumt es auf (der älteste bleibt).

Migration 13 `shop_data_model` legt die Shop-Indizes einmal an und steht danach in `schema_migrations`.

```bash
docker compose exec backend python scripts/shop_schema.py                       # Trockenlauf: was fehlt, wie viele Zeilen
docker compose exec backend python scripts/shop_schema.py --anwenden            # fehlende Indizes anlegen
docker compose exec backend python scripts/shop_schema.py --abbauen             # Rückweg ansehen
docker compose exec backend python scripts/shop_schema.py --abbauen --anwenden  # Rückweg ausführen
```

Der Rückweg entfernt die Shop-Indizes und trägt Migration 13 aus – nur, solange **keine** Shop-Sammlung Daten hat;
sonst verweigert er (Rückgabe 1) und nennt die Sammlungen. Danach die ältere Version einspielen
(`scripts/rollback-release.sh`); läuft die neue weiter, legt der nächste Start die Indizes wieder an. Sammlungen
selbst entfernt er nicht – leere Sammlungen ohne Index stören nicht.

### Datenschutz und Sicherheit

- Personenbezogene Felder stehen in `shop_common.PERSONAL_FIELDS`: an Bestellungen Konto, Rechnungs- und
  Lieferanschrift; an Positionen Konto und Gamertag; der Warenkorb. Die Einordnung für Auskunft und Löschung steht in
  `services/personal_data.py`:
  - **Auskunft:** `shop_orders` (ohne interne Schlüssel), `shop_order_items`, `shop_cart`.
  - **Kontolöschung:** Bestellungen und Positionen behalten Beträge und Verlauf für die Buchhaltung (die Rechnung
    liegt in Dolibarr); Anschriften werden bis auf das Land überschrieben, der Gamertag entfernt, der Warenkorb
    gelöscht. Ereignisse bleiben – sie tragen keine Anschrift. Fristen und offene Bestellungen regelt #1731.
- **Keine Bank- und Zugangsdaten im Modell.** Bezahlt wird per Überweisung auf die Dolibarr-Rechnung; Schlüssel für
  Printful gehören in den verschlüsselten Speicher (#1705/#1706). `shop_common.FORBIDDEN_FIELD_PARTS` und
  `test_shop_model_unit` halten jedes Feld daran fest.
- Preise bestimmt nur der Server. Die Bestellung nimmt Variante, Menge und Gamertag – nie einen Preis.

## Rechte und Protokoll

Bereich **Finanzen** (`finance`) mit Zwei-Faktor, kein eigener Bereich. Club-Admin und Superadmin haben ihn über
die Rolle, andere über eine Freigabe. Matrix: [docs/ROLLEN.md](ROLLEN.md#shop-1704).

| Route | Zweck |
| --- | --- |
| `GET /api/admin/shop/products` | Produkte lesen |
| `POST /api/admin/shop/products` | Produkt anlegen (mit Grund) |
| `GET /api/admin/shop/products/{id}` | Produkt mit Varianten |
| `PATCH /api/admin/shop/products/{id}` | Produkt ändern (mit Grund) |
| `POST /api/admin/shop/products/{id}/variants` | Variante anlegen (mit Grund) |
| `PATCH /api/admin/shop/variants/{id}` | Variante ändern (mit Grund) |
| `GET /api/admin/shop/orders` | Bestellungen lesen – ohne Anschriften |
| `GET /api/admin/shop/orders/{id}` | Bestellung mit Positionen, Anschriften und Verlauf |

`scripts/check-code-patterns.py` (Regel 3) hält fest: Jede Route mit `shop` im Pfad liegt unter `/api/admin/shop`
und hängt an `require_area("finance")`; eine öffentliche Shop-Route schlägt fehl, bis sie mit #1706/#1712 bewusst
freigegeben wird.

**Protokoll** (Betrieb → Ereignisse, Quelle Adminaktionen): `shop_common.record_admin_action` schreibt jede Aktion
mit Person (`actor_id`), Ziel und Grund (Pflicht, eine Zeile, Mail-Adressen gekürzt) – nie mit Anschrift. Preis- und
Sichtbarkeitsänderungen stehen als eigene Einträge mit vorher und nachher. Lesen ist keine Adminaktion; ein Speichern
ohne Änderung schreibt nichts.

| Aktion | Wann |
| --- | --- |
| `shop.product.create`, `shop.product.update` | Produkt angelegt bzw. geändert |
| `shop.product.price` | Preis oder Aufschlag eines Produkts bzw. Preis einer Variante |
| `shop.product.visibility` | Sichtbarkeit |
| `shop.variant.create`, `shop.variant.update` | Variante angelegt bzw. geändert |
| `shop.design.add`, `shop.printful_variant.set` | Druckdatei-Fassung, Printful-Zuordnung |
| `shop.order.release`, `shop.order.printful_confirm`, `shop.order.cancel` | vorgesehen für #1718, #1721 |
| `shop.order.club`, `shop.order.prize` | vorgesehen für #1724, #1726 |
| `shop.config` | vorgesehen für #1706 |

**Menü:** Einen Eintrag „Shop“ unter Finanzen gibt es noch nicht – es gibt keine Seite dafür (die Produktverwaltung
kommt mit #1707). Mit der ersten Seite kommen Menüeintrag, `e2e/admin-navigation.spec.js` und
`permissions.parity.test.js` dazu.
