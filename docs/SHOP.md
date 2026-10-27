# Vereinsshop

Stand: Fundament aus #1703 (Datenmodell) und #1704 (Rechte, Protokoll), dazu Stufen, Notschalter und Preise aus
#1706 (Abschnitt „Einstellungen“ unten), Designs/Druckdateien aus #1708 (Abschnitt „Designs und Druckdateien“) und
der Printful-Adapter aus #1705 (Abschnitt „Printful-Adapter“), die Produktverwaltung aus #1707 mit dem Katalogabgleich
aus #1709 (Abschnitt „Produktverwaltung und Katalogabgleich“), Teil des Epics #1699. Der Shop ist **von außen
unsichtbar**: Es gibt keine Seiten für Mitglieder und nur eine öffentliche Route - die Druckdateien für Printful hinter
einem Zufallsschlüssel; im Admin steht er unter Finanzen → Shop. Steuer (#1701) und die Shop-Seiten (#1712 ff.) folgen.

Code: `backend/services/shop_common.py` (Fehler, Anschriften, Protokoll, personenbezogene Felder),
`shop_catalog.py` (Katalog), `shop_designs.py` (Druckdateien, #1708), `shop_orders.py` (Bestellungen, Ereignisse,
Warenkorb), `shop_schema.py` (Indizes, Migration 13), `backend/routes/shop_admin_routes.py` und
`shop_design_routes.py` (Adminbereich), `shop_print_file_routes.py` (Druckdateien für Printful),
`backend/scripts/shop_schema.py` (Werkzeug).

## Datenmodell

**Schreibzugriffe nur über die Services.** Routen und andere Services rufen `shop_catalog` und `shop_orders`, nie
die Sammlungen direkt. Jede Katalogänderung ist eine Adminaktion mit Person und Grund.

| Sammlung | Inhalt | Eindeutig |
| --- | --- | --- |
| `shop_products` | Produkt: Slug, Titel, Beschreibung, Stand (`draft` Entwurf, `reviewed` geprüft, `active` veröffentlicht, `archived`), Sichtbarkeit (`hidden` nur intern, `members` nur Mitglieder, `public` öffentlich mit Konto), Personalisierung (`none`, `gamertag`, `member_number`, `both`; daraus `gamertag_allowed`), Grundpreis (ohne Printful, sonst leer) und eigener Aufschlag in Cent (leer = allgemeiner gilt), Steuerprofil (Referenz), ältere Einzel-Druckdatei (`design_key`), `version`; seit #1707 der Aufbau: Printful-Abzug (`printful`), Technik, Angebot (`offer`: Farben, Größen), Platzierungen (`placements`), Fläche im Grundpreis (`included_placement`), Prüfung (`review`), `published_at`, `archived_at` und der Stand des Abgleichs (`catalog_sync`) | `slug` |
| `shop_variants` | Variante eines Produkts: SKU, Bezeichnung, Größe, Farbe (mit `color_code`), Preis (bei Printful-Produkten der übernommene Selbstkostenpreis), aktiv (= angeboten), Sperre aus dem Abgleich (`blocked_reason`, `blocked_at`), `version` | `sku` |
| `shop_designs` | Druckdatei des Vereins je Fassung: `design_key`, `version` (zählt hoch), `file_ref`, `sha256`, Druckposition; seit #1708 dazu `public_id` (Zufallsschlüssel der öffentlichen Adresse), Pixel, DPI und Druckmaße in Zoll, mit denen sie geprüft wurde, Transparenz, Ausgangsformat und `public_disabled_at` (Aufbewahrung). Alte Fassungen bleiben | `design_key` + `version`; `public_id` |
| `shop_design_profiles` | Design (#1708): Titel, Platzierung und die **Shirtfarben**, für die es gilt (`garment_colors`), Notiz, `version` | `design_key` |
| `shop_design_colors` | Belegung einer Shirtfarbe je Platzierung durch ein Design (#1708): `placement`, `color_key` (kleingeschrieben), `color`, `design_key` - macht „eine Farbe, ein Design“ atomar | `placement` + `color_key` |
| `shop_printful_variants` | Zuordnung Variante → Printful-Variante und -Produkt (Anbieter `printful`); seit #1709 Technik, Einkauf (`base_cost_cents`), Aufpreis je Druckfläche (`placement_costs`), Lager (`availability`, `in_stock`), `synced_at` und eine offene Preiswarnung (`price_warning`) | `provider` + `variant_id` |
| `shop_carts` | Warenkorb je Konto: Variante, Menge, Gamertag – keine Preise | `user_id` |
| `shop_orders` | Bestellung mit allem Eingefrorenen (unten), Stand, Rechnungs- und Lieferanschrift, `printful_external_id` | `idempotency_key`, `printful_external_id` |
| `shop_order_items` | Position einer Bestellung, eingefroren | `order_id` + `position` |
| `shop_order_events` | Verlauf einer Bestellung, **nur angehängt** | `order_id` + `event_key` |
| `shop_printful_drafts` | Claim vor dem Anlegen eines Printful-Entwurfs (#1705): `external_id`, Stand (`sending`, `created`, `failed`, `deleting`), Printful-Nummer – keine Person | `external_id` |
| `shop_printful_confirmations` | Claim vor dem Bestätigen bei Printful (#1705): Idempotenzschlüssel, Auftragsnummer, Stand (`sending`, `confirmed`, `unclear`) – keine Person | `order_id`, `idempotency_key` |

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
  Seit #1707 je Platzierung (`designs`): Platzierung, Art, Printful-Druckfläche, Technik, Position in Zoll und die
  Fassung des Designs für die Farbe der Variante (`design_key`, `version`, `sha256`) - **alle** Platzierungen, nicht
  nur eine. Gamertag- und Vereinsnummer-Felder stehen als Platzhalter darin (Datei je Bestellung, #1711); ein Produkt
  mit Gamertag-Feld verlangt einen Gamertag. `design` bleibt als Kurzform (erstes Design). Gesperrte Varianten und
  Varianten ohne übernommenen Preis sind nicht bestellbar.
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
| `GET /api/admin/shop/products` | Produkte lesen, mit Übersicht (Stand, Printful, Sperren, Preiswarnungen) |
| `POST /api/admin/shop/products` | Produkt anlegen (mit Grund; nur Titel Pflicht, immer Entwurf) |
| `GET /api/admin/shop/products/{id}` | Produkt mit allem für den Aufbau (#1707, Abschnitt unten) |
| `PATCH /api/admin/shop/products/{id}` | Grunddaten ändern (mit Grund) - nie den Stand |
| `POST /api/admin/shop/products/{id}/variants` | Variante anlegen (mit Grund) |
| `PATCH /api/admin/shop/variants/{id}` | Variante ändern (mit Grund) |
| `GET /api/admin/shop/orders` | Bestellungen lesen – ohne Anschriften |
| `GET /api/admin/shop/orders/{id}` | Bestellung mit Positionen, Anschriften und Verlauf |

`scripts/check-code-patterns.py` (Regel 3) hält fest: Jede Route mit `shop` im Pfad liegt unter `/api/admin/shop`
und hängt an `require_area("finance")`. Öffentlich ist nur, was in `PUBLIC_SHOP_ROUTES` mit Methode, genauem Pfad,
Datei und Begründung steht - bisher allein `GET /api/shop/print-files/{public_id}/{filename}` (#1708). Jede andere
öffentliche Shop-Route schlägt fehl, bis sie dort bewusst freigegeben wird (Shop-Seiten #1712).

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
| `shop.design.add`, `shop.printful_variant.set` | Druckdatei-Fassung (mit Prüfsumme, Pixeln, DPI - nie mit dem Zufallsschlüssel), Printful-Zuordnung |
| `shop.design.profile` | Design angelegt bzw. Titel, Shirtfarben (vorher/nachher) oder Notiz geändert (#1708) |
| `shop.design.placement` | Druckbreite, Druckbereich oder Mindest-DPI einer Platzierung, vorher/nachher (#1708) |
| `shop.product.catalog`, `shop.product.offer` | Printful-Produkt gewählt (vorher/nachher), Farben und Größen angeboten (#1707) |
| `shop.product.placements`, `shop.product.designs` | Platzierungen mit Position (vorher/nachher), Design je Platzierung und Farbe (#1707) |
| `shop.product.status` | Stand vorher/nachher mit Prüfergebnis; auch „zurück auf Entwurf“ nach einer Änderung (#1707) |
| `shop.catalog.sync` | Abgleich mit Printful: gesperrte, freigegebene Varianten, Preisänderungen - nur wenn sich etwas ändert (#1709) |
| `shop.order.release`, `shop.order.printful_confirm`, `shop.order.cancel` | vorgesehen für #1718, #1721 |
| `shop.order.club`, `shop.order.prize` | vorgesehen für #1724, #1726 |
| `shop.config` | Einstellungen geändert (#1706): Stufe, Freigabe „Steuer geklärt“, Notschalter, Preise, Printful-Schlüssel – mit vorher und nachher, nie mit Schlüssel |

**Menü:** Verwaltung → Finanzen → **Shop** (`/admin/shop`, #1706) - ein Menüeintrag mit Reitern: **Einstellungen**
(`/admin/shop`), **Produkte** (`/admin/shop/products`, #1707) und **Designs** (`/admin/shop/designs`, #1708). Der
Testentwurf (#2062) kommt als weiterer Reiter dazu (`frontend/src/pages/admin/ShopTabs.jsx`), ohne das Menü zu
verlängern.

## Einstellungen, Stufen und Notschalter (#1706)

Code: `backend/services/shop_config.py` (ein Dokument `settings` mit `id = "shop"`), `shop_access.py` (wer sieht den
Shop), Verbindungstest über den Printful-Adapter (`printful_client.py`, unten). Entscheidung des Obmanns vom 27.10.2026: **Stufen statt
„Aus/Vorschau/Live“.**

| Stufe | Wer sieht den Shop | Wer darf sie einschalten |
| --- | --- | --- |
| Aus (Vorgabe) | niemand | Finanzen |
| Nur Admins (Test) | Finanzen, Club-Admin, Superadmin (mit Zwei-Faktor) | Finanzen |
| Vereinsmitglieder | aktive Mitgliedschaft (auch Ehrenmitglieder) und die Finanzen | Finanzen |
| Öffentlich | alle, auch ohne Anmeldung | nur Superadmin, nur mit „Steuer geklärt“ |

- **„Steuer geklärt“** (#1701) ist ein eigener Schalter, nur Superadmin, mit Pflicht-Grund. Fehlt er, ist „Öffentlich“
  im Admin gesperrt (mit Hinweis) und die Route antwortet 409 (Finanzen ohne Superadmin: 403). Zurücknehmen geht nur,
  wenn der Shop nicht öffentlich ist. Absenken der Stufe ist nie gesperrt.
- **Sicher bei Unsinn:** eine unbekannte Stufe in der Datenbank und „Öffentlich“ ohne Freigabe gelten als „Aus“.
- **Helfer für die Shop-Seiten (#1712):** `shop_access.can_view_shop(db, user)`; als Wächter
  `Depends(shop_access.require_shop_viewer())` – wer nicht darf, bekommt 404. Öffentliche Shop-Routen brauchen dann
  eine bewusste Erweiterung von Regel 3 in `scripts/check-code-patterns.py`.
- **Notschalter „Bestellungen an Printful senden“** (Vorgabe aus) hängt nicht an der Stufe. Jeder Aufruf bei Printful,
  der Geld kostet (Bestätigen), ruft vorher `shop_config.require_printful_writes(db)`; aus heißt
  `PrintfulWritesBlocked`, nichts geht hinaus. Einschalten nur mit lesbarem Schlüssel; wer den Schlüssel entfernt,
  schaltet ihn mit aus. **Entwürfe** (anlegen, löschen, Druckdateien) kosten nichts und brauchen nur
  `shop_config.require_printful_drafts(db)`: Stufe ab „Nur Admins (Test)“ und lesbarer Schlüssel, sonst
  `PrintfulDraftsBlocked` - auch bei ausgeschaltetem Notschalter (#2062).
- **Preise:** Mitglieder zahlen den Selbstkostenpreis (Einkauf plus Versand), ihr Aufschlag ist fest 0. Der
  öffentliche Aufschlag ist ein fester Betrag je Artikel (Vorgabe 0, höchstens 100 €) und greift nur bei der Kaufart
  `public`. Trägt ein Produkt einen eigenen Aufschlag, **ersetzt** er den allgemeinen (Entscheidung zu #1707, vorher
  wurden beide addiert) - auch ein eigener Aufschlag von 0 €; leer heißt „der allgemeine gilt“. `place_order` friert
  den Betrag ein.
- **Versand:** nur nach Österreich (`SHIPPING_COUNTRIES = ("AT",)`, `place_order` lehnt andere Lieferländer ab).
  Den Versand bestimmt `place_order` selbst: der Aufrufer gibt nur `shipping_estimate_cents` (die Schätzung von
  Printful oder `None`), `shipping_cents(config, schätzung)` nimmt die Schätzung, sonst die **Ersatzpauschale**; fehlt
  auch die (Vorgabe: keine), wird nicht bestellt – kein Versand zum Nulltarif. 0 € nur, wenn die Schätzung
  ausdrücklich 0 ist. Eingefroren werden Betrag und Herkunft (`frozen.shipping_source`: `estimate` oder `fallback`).
- **Printful-Zugang:** Schlüssel verschlüsselt mit `SETTINGS_ENCRYPTION_KEY` (`secret_store`), nie wieder angezeigt –
  nur „hinterlegt seit … von …“. Hinterlegen und Entfernen braucht zusätzlich den Bereich System. „Verbindung testen“
  ruft über den Adapter genau einmal lesend `GET https://api.printful.com/v2/stores` auf und merkt sich Zeitpunkt,
  ja/nein und Ursache.
- **Betrieb → Checks** zeigt „Shop“: Stufe, Notschalter, Schlüssel (hinterlegt, fehlt, nicht lesbar) und die Ursache
  eines gescheiterten Verbindungstests. Rot nur, wenn Bestellungen hinausgehen sollen, es aber nicht können.

| Route (alle `require_area("finance")`) | Zweck |
| --- | --- |
| `GET /api/admin/shop/config` | Einstellungen, Stufen mit Sperre, Rechte – ohne Schlüssel |
| `PATCH /api/admin/shop/config` | Stufe, Notschalter, öffentlicher Aufschlag, Ersatzpauschale (mit Grund) |
| `PUT /api/admin/shop/config/tax-clearance` | „Steuer geklärt“ setzen oder zurücknehmen (nur Superadmin, mit Grund) |
| `PUT /api/admin/shop/config/printful-key` | Schlüssel hinterlegen (zusätzlich System, mit Grund) |
| `POST /api/admin/shop/config/printful-key/remove` | Schlüssel entfernen (zusätzlich System, mit Grund) |
| `POST /api/admin/shop/config/printful-test` | Verbindung testen (nur lesen) |

Neue Umgebungswerte braucht es nicht: der Schlüssel liegt verschlüsselt in der Datenbank. Offen aus #1706: der
Abschnitt „Zahlungsbedingungen für den Shop“ (Dolibarr-Zahlungsbedingungen, Erinnerungen) folgt in einem eigenen Paket.


## Designs und Druckdateien (#1708)

Code: `backend/services/shop_designs.py`, Routen `backend/routes/shop_design_routes.py` (Admin) und
`shop_print_file_routes.py` (öffentlich für Printful), Seite `frontend/src/pages/admin/AdminShopDesignsPage.jsx`
(Verwaltung → Finanzen → Shop → Reiter **Designs**). Käufer laden nie etwas hoch; Druckdateien kommen nur von den
Finanzen.

**Upload** (nur Finanzen mit Zwei-Faktor, mit Grund, Protokoll `shop.design.add`):

- Nur **PNG oder JPG**, höchstens 50 MB (`SHOP_DESIGN_MAX_MB`) und 40 Millionen Pixel. SVG (auch als `.png`
  getarnt), WebP, GIF, PDF, animierte PNG und 16-Bit-Graustufen werden mit Text abgelehnt.
- **Limit am Eingang:** `services/body_limits.py` lehnt die Upload-Route mit 413 ab, sobald `Content-Length` mehr als
  50 MB plus 256 KB Formular sagt - oder beim Mitzählen, wenn die Angabe fehlt -, bevor FastAPI etwas in eine
  Zwischendatei schreibt. nginx begrenzt genau diese Route auf 51 MB (global sind 1700 MB für Videos erlaubt).
- **Neu kodiert:** Pillow liest die Pixel, ein eingebettetes Farbprofil wird nach sRGB umgerechnet, dann entsteht aus
  den nackten Pixeln ein neues PNG. EXIF, GPS, Texte, Profile und Anhänge der Originaldatei kommen nicht mit; das
  Original wird nicht gespeichert. **Transparenz bleibt** (RGBA). Ein JPG wird zum PNG ohne Transparenz - die Seite
  warnt, dass dann der Hintergrund mitgedruckt wird. Im PNG steht nur die DPI bei der Druckbreite.
- Anders als die übrigen Bild-Uploads wird **nicht verkleinert**: Druckdateien brauchen ihre volle Auflösung.

**Prüfung je Platzierung.** Je Platzierung eine einstellbare Vorgabe (Dokument `settings` mit
`id = "shop_design_placements"`, Protokoll `shop.design.placement` mit vorher/nachher): Druckbreite, Breite und Höhe
des Druckbereichs (Zoll) und Mindest-DPI. DPI = Pixelbreite / Druckbreite; die Höhe folgt aus dem Seitenverhältnis.

| Platzierung | Druckbreite | Druckbereich | Mindest-DPI |
| --- | --- | --- | --- |
| Brust rechts (vom Träger aus) – Löwe | 3,5 Zoll (8,9 cm) | 5 × 5 Zoll (12,7 × 12,7 cm) | 300 |
| Brust links (vom Träger aus) – Namensfeld | 3,5 Zoll (8,9 cm) | 5 × 5 Zoll (12,7 × 12,7 cm) | 300 |
| Rücken, Vorderseite groß | 10 Zoll (25,4 cm) | 12 × 16 Zoll (30,5 × 40,6 cm) | 300 |
| Ärmel links/rechts | 3 Zoll (7,6 cm) | 3,5 × 3,5 Zoll (8,9 × 8,9 cm) | 300 |
| Innenetikett | 2,5 Zoll (6,4 cm) | 3 × 3 Zoll (7,6 × 7,6 cm) | 300 |

Die Vorgaben stammen aus dem Testshirt (Löwe 3,5 Zoll); die Druckbereiche sind vorsichtig gewählt und mit Printful zu
bestätigen (#1700). Printful nimmt ab 150 DPI, der Verein verlangt 300. Zu wenig wird abgelehnt, etwa: „Zu wenig
Auflösung: bei 3,5 Zoll (8,9 cm) Breite hat die Datei nur 150 DPI, nötig sind 300. Dafür braucht sie mindestens 1050
Pixel Breite“; ebenso ein Motiv, das bei der Druckbreite höher wird als der Druckbereich. Die **Ampel** im Admin rechnet
immer mit der geltenden Vorgabe: **Gut** (ab 120 % der Mindest-DPI), **Knapp** (darunter), **Reicht nicht** (zu wenig
oder zu hoch, etwa nach einer geänderten Vorgabe). Jede Version behält die Maße, mit denen sie geprüft wurde.

**Versionen.** Jede neue Datei ist eine neue Version (`shop_catalog.add_design_version`) mit SHA-256 der gespeicherten
Datei, eigener Datei auf der Platte (`UPLOAD_DIR/shop-designs/<zufällig>.png`, mit `xb` angelegt - nie überschrieben)
und eigenem Zufallsschlüssel. Dieselbe Datei wie die aktuelle Version ergibt keine neue (409). Eine Bestellung friert
`design_key`, `version` und `sha256` ein und behält damit ihre Version samt Adresse. Ein Design behält seine
Platzierung; für eine andere Platzierung gibt es ein eigenes Design.

**Öffentliche Adresse für Printful:** `GET /api/shop/print-files/<public_id>/<design>-v<version>.png`

- `public_id` = `secrets.token_urlsafe(32)` (256 Bit), je Version neu, unabhängig von Design, Version und Prüfsumme.
  Die Version steht im Namen, damit Printful eine neue Datei nicht aus dem Zwischenspeicher nimmt.
- Schlüssel **und** Name müssen genau passen; sonst - auch bei abgeschalteter Version - dieselbe 404. Keine Liste,
  kein Verzeichnis, keine Aufzählung; der Schlüssel steht nicht im Protokoll.
- Ausgeliefert wird nur die fertige Druckdatei als `image/png` mit `nosniff`, `no-store`, `noindex` und
  `Content-Security-Policy: default-src 'none'; sandbox` und `Referrer-Policy: no-referrer` (die globale Middleware
  überschreibt eine strengere Regel einer Route nicht mehr).
- **Nicht in den Protokollen:** Uvicorns Zugriffsprotokoll kürzt den Pfad zu `/api/shop/print-files/***/…`
  (`log_safe.SecretPathFilter`). nginx schreibt für diesen Pfad das Format `tls_redacted` (wie `main`, mit gekürzter
  Anfragezeile) und Fehlerzeilen nur ab `crit`, weil nginx-Fehlerzeilen die volle Anfrage nennen.
- Unabhängig von Stufe und Notschalter: Printful braucht die Dateien auch für Testentwürfe (#2062) und bestehende
  Bestellungen. Im Admin kopiert „Adresse für Printful“ die volle Adresse (`PUBLIC_BACKEND_URL`, `PUBLIC_BASE_URL`
  oder `FRONTEND_URL` davor). Hochladen zu Printful übernimmt der Adapter (#1705) über diese Adresse.
- Bewusste Ausnahme in Regel 3 (`scripts/check-code-patterns.py`, `PUBLIC_SHOP_ROUTES`), Tests in
  `test_code_patterns_unit.py` und `test_shop_print_files_flow.py`.

**Aufbewahrung (vorbereitet, nichts wird automatisch gelöscht).** `shop_designs.retention_plan(db)` ist ein Bericht:

- Die neueste Version eines Designs bleibt öffentlich.
- Eine ältere Version, auf die eine Bestellung zeigt, bleibt öffentlich - bis die Statusmaschine (#1716)
  „abgeschlossen“ kennt; dann gilt die Frist ab Abschluss.
- Eine ältere Version ohne Bestellung darf 90 Tage nach ihrer Ablösung abgeschaltet werden (`public_disabled_at`
  setzen; die Adresse antwortet dann 404). Die Datei bleibt für den Nachweis liegen.
- Endgültiges Löschen der Dateien regelt #1731 (Aufbewahrungsfristen). Bis dahin löscht nichts.

**Shirtfarben.** Ein Design gilt für eine Liste von Shirtfarben (`garment_colors`, Schreibweise wie an den Varianten,
Groß-/Kleinschreibung egal) - etwa `loewe-weiss` für Schwarz und Navy, `loewe-schwarz` für Weiß und Hellgrau. Je
Platzierung gehört eine Farbe zu höchstens einem Design (sonst 409) - atomar über `shop_design_colors` mit eindeutigem
Index, auch bei zwei gleichzeitigen Änderungen. Die Produktverwaltung (#1707) fragt
`shop_designs.design_for_color(db, platzierung, farbe)` und bekommt Design und neueste Version - oder `None`, dann ist
die Variante ohne Druckdatei.

| Route (alle `require_area("finance")`) | Zweck |
| --- | --- |
| `GET /api/admin/shop/designs` | Designs mit Versionen, Ampel, Adressen; Druckbereiche je Platzierung |
| `POST /api/admin/shop/designs/upload` | Datei hochladen (Formular: `file`, `design_key`, `reason`; neues Design dazu `title`, `placement`, `garment_colors`) |
| `PATCH /api/admin/shop/designs/{design_key}` | Titel, Shirtfarben, Notiz (mit Grund) |
| `PUT /api/admin/shop/designs/placements/{placement}` | Druckbreite, Druckbereich, Mindest-DPI in Zoll (mit Grund) |

Nicht in #1708: der Editor mit Ebenen, Hilfslinien und Drag-and-drop (Teil 2), die Gamertag-Druckdatei (#1711),
Mockups (#1710) und das Hochladen zu Printful (#1705).

## Produktverwaltung und Katalogabgleich (#1707, #1709)

Code: `backend/services/shop_products.py` (Aufbau, Prüfung, Stand, Ansicht), `shop_catalog_sync.py` (Abgleich),
`shop_costs.py` (Selbstkosten aus Einkauf und Aufpreisen),
Routen `backend/routes/shop_product_routes.py` (Schritte) und `shop_admin_routes.py` (Anlegen, Grunddaten, Lesen),
Seite `frontend/src/pages/admin/AdminShopProductsPage.jsx` (Verwaltung → Finanzen → Shop → Reiter **Produkte**).
Beispiel aus #2062: Gildan 5000 schwarz mit Löwe vorne rechts, Gamertag vorne links und Rückenlogo.

**Fünf Schritte** - jeder mit Grund und Protokoll, jede Antwort die volle Ansicht samt Vorab-Prüfung:

1. **Produkt wählen:** Grunddaten (Titel, Beschreibung - bereinigt -, Sichtbarkeit, Personalisierung) und die
   Printful-Produktnummer. Die Website lädt über den Adapter Produkt und Varianten (Größe, Farbe, Variantennummer,
   Lager, Druckflächen mit Maßen) und speichert einen Abzug - **ohne Preise**. Eine Textsuche bietet Printful v2 nicht
   (nur Filter nach Kategorie); die Nummer kommt aus dem Printful-Katalog. Eine Variantennummer als Produktnummer findet
   Printful nicht - die Meldung sagt das. Ein anderes Printful-Produkt setzt Angebot und Technik zurück; vorhandene
   Varianten bleiben (Bestellungen zeigen auf sie), werden aber inaktiv.
2. **Farben und Größen:** Technik, Farben, Größen. Je Farbe × Größe eine Variante (SKU `PF<Printful-Variante>-<Produkt>`)
   mit Zuordnung zur Printful-Variante; danach holt der Abgleich die Einkaufspreise **nur für diese** (höchstens 80 je
   Produkt - je Variante ein Preisaufruf).
3. **Designs je Platzierung:** Platzierungen aus den Druckflächen des Printful-Produkts. Brust links/rechts und
   „Vorderseite groß“ liegen auf der Printful-Fläche `front`, die Rückseite auf `back` (eigener Aufpreis). Position,
   Breite und Höhe in Zoll (Anzeige mit cm), von vorne gesehen ab links oben im Druckbereich; die Vorlage kommt aus den
   Druckbereichen der Designs (#1708), „Brust rechts vom Träger aus“ liegt von vorne gesehen links. Je Platzierung und
   angebotener Farbe ein Design dieser Platzierung, vorgeschlagen über `design_for_color`. Art **Gamertag** bzw.
   **Vereinsnummer** ist ein Platzhalter (Datei je Bestellung, #1711) und nur mit passender Personalisierung erlaubt.
4. **Preise:** Mitgliederpreis = **Selbstkostenpreis**: Einkauf der Variante (Technik) plus Aufpreis jeder weiteren
   Printful-Druckfläche; eine Fläche steckt im Grundpreis (`included_placement`, Vorgabe `front`). Ohne Aufschlag.
   Öffentlicher Preis = Einkauf plus Aufschlag als Vorschlag; der eigene Aufschlag des Produkts ersetzt den
   allgemeinen. „Preise übernehmen“ schreibt die Selbstkosten in die Varianten - nur so kommen Preise von Printful in
   den Shop. Ob die Fläche im Grundpreis stimmt, zeigt die Kostenschätzung im Testentwurf (#2062).
5. **Prüfen und veröffentlichen:** Entwurf → **geprüft** → **veröffentlicht** → archiviert.

**Vorab-Prüfung** (`run_check`): Printful-Produkt geladen und nicht eingestellt; Farben und Größen gewählt;
Sichtbarkeit und Personalisierung passen zu den Platzierungen; mindestens eine Platzierung mit Design; **jede
angebotene Farbe hat an jeder Design-Platzierung eine gültige, öffentliche Datei** (sonst nennt die Prüfung Platzierung
und Farbe); alle angebotenen Varianten lieferbar; Preis berechnet und übernommen, ohne offene Preiswarnung. Dazu die
**Mockup-Prüfung**: bis #1710 „offen“. „Geprüft“ braucht alles außer den Mockups, „veröffentlicht“ alles - bis #1710
lässt sich also nichts veröffentlichen.

**Regeln:** Den Stand ändert nur `POST …/status` (ein gewöhnliches Speichern lehnt `status` ab). Ein geprüftes Produkt
fällt bei jeder Änderung des Aufbaus (auch der Personalisierung) zurück auf „Entwurf“; ein veröffentlichtes ändert man
erst nach dem Zurückziehen - nur „Preise übernehmen“ geht auch veröffentlicht. Archivierte Produkte bleiben lesbar.
„Öffentlich“ plus Personalisierung lehnt der Server immer ab.

**Abgleich** (`shop_catalog_sync`): auf Knopfdruck („Mit Printful abgleichen“) und täglich um 05:20 Wiener Zeit
(Scheduler-Job `shop_catalog_sync`, alle nicht archivierten Produkte mit Printful-Produkt, ohne Schlüssel nichts).

- Nicht lieferbar (Printful meldet nicht „in stock“ oder kennt die Variante nicht mehr): Variante gesperrt
  (`blocked_reason`), `place_order` nimmt sie nicht; wieder lieferbar hebt die Sperre auf.
- Preisänderung: neuer Einkauf an der Zuordnung plus `price_warning` (vorher/nachher, seit) - der Preis der Variante
  bleibt, bis die Finanzen übernehmen. Bestehende Bestellungen haben ihre Preise eingefroren.
- Ausfall: nichts ändert sich; `catalog_sync` merkt Zeitpunkt, Ursache und `last_ok_at` - der Admin zeigt den letzten
  Stand mit Datum.
- Rate-Limit: je angebotener Variante ein Preisaufruf; ein Client je Lauf bleibt unter 100 Aufrufen je Minute.

| Route (alle `require_area("finance")`) | Zweck |
| --- | --- |
| `POST /api/admin/shop/products/{id}/printful` | Schritt 1: Printful-Produkt laden (`printful_product_id`, Grund) |
| `PUT /api/admin/shop/products/{id}/offer` | Schritt 2: Technik, Farben, Größen (Grund) - danach Preise |
| `PUT /api/admin/shop/products/{id}/placements` | Schritt 3: Platzierungen mit Art und Position, Fläche im Grundpreis (Grund) |
| `PUT /api/admin/shop/products/{id}/designs` | Schritt 3: Design je Platzierung und Farbe, `null` entfernt (Grund) |
| `POST /api/admin/shop/products/{id}/prices/accept` | Schritt 4: Selbstkosten als Mitgliederpreis übernehmen (Grund) |
| `POST /api/admin/shop/products/{id}/sync` | Mit Printful abgleichen (Grund freiwillig, Person im Protokoll) |
| `POST /api/admin/shop/products/{id}/status` | Schritt 5: `reviewed`, `active`, `draft`, `archived` (Grund) |

Offen für spätere Pakete: Mockups und ihre Prüfung (#1710), die Gamertag- bzw. Vereinsnummer-Datei (#1711) - ob
Printful zwei Ebenen auf `front` annimmt oder Löwe und Gamertag zu einer Front-Datei zusammengesetzt werden müssen,
klärt der Testentwurf (#2062) -, Fotos, Galerie und Größentabelle, der visuelle Editor (Ergänzung vom 15.10.).

## Printful-Adapter (#1705)

Code: `backend/services/shop_fulfillment.py` (austauschbare Schnittstelle `FulfillmentProvider`, Typen, Fehlerklassen)
und `backend/services/printful_client.py` (`PrintfulClient`, die Umsetzung für Printful). Vertrag:
`backend/tests/contracts/printful/` (Ausschnitt der OpenAPI-Beschreibung plus `manifest.json`), Fake:
`backend/tests/printful_fake.py`. Den Adapter rufen „Verbindung testen“ und die Produktverwaltung (Katalog und
Abgleich, #1707/#1709); die Testansicht kommt mit #2062.

**Version: Printful API v2** (`https://api.printful.com/v2/…`, Stand 27.10.2026 „Open Beta“, laut Printful für den
Betrieb freigegeben). Gründe:

- `POST /v2/orders` legt **immer** einen Entwurf an, bestätigt wird nur über `POST /v2/orders/{id}/confirmation`. In
  v1 entscheidet ein Abfrageparameter `confirm=true` beim Anlegen – genau die Falle, die ausgeschlossen sein soll.
- Nur v2 signiert Webhooks (HMAC-SHA256, Kopf `x-pf-webhook-signature`); v1 kennt keine Signatur.
- Katalog mit Druckflächen und Techniken, Preis und Lager je Verkaufsregion, Kostenschätzung als Aufgabe mit nur Land
  und PLZ, Mockup-Aufgaben und `Retry-After` sind in v2 beschrieben.
- Risiko: Beta. Ändert Printful etwas, scheitert zuerst der Vertrag (`manifest.json` nennt Quelle und Stand).

### Wege

| Funktion | Weg | Sperre | Wiederholt |
| --- | --- | --- | --- |
| `check_connection` | `GET /v2/stores` | – | nein (ein Aufruf) |
| `catalog_product` | `GET /v2/catalog-products/{id}` | – | ja |
| `catalog_variants` | `GET /v2/catalog-products/{id}/catalog-variants`, `…/availability`, `GET /v2/catalog-variants/{id}/prices` | – | ja |
| `estimate_costs` | `POST /v2/order-estimation-tasks`, dann `GET /v2/order-estimation-tasks?id=` | – | Anlegen nein, Abfragen ja |
| `create_draft` | `GET /v2/orders/@{external_id}`, dann `POST /v2/orders` | Entwurf | nein |
| `get_order` | `GET /v2/orders/{id}` bzw. `@{external_id}`, `GET /v2/orders/{id}/order-items` | – | ja |
| `delete_draft` | `GET /v2/orders/{id}`, dann `DELETE /v2/orders/{id}` (nur Stand `draft`) | Entwurf | nein |
| `confirm_order` | `POST /v2/orders/{id}/confirmation` | Notschalter | nein |
| `add_file`, `get_file` | `POST /v2/files` (`role = printfile`, per https-Adresse), `GET /v2/files/{id}` | Entwurf (nur Anlegen) | Anlegen nein |
| `create_mockup_task`, `get_mockup_task` | `POST /v2/mockup-tasks`, `GET /v2/mockup-tasks?id=` | – | Anlegen nein |
| `verify_webhook_signature` | – (nur die Prüffunktion; die Route kommt mit #1720) | – | – |

**Sperren:** „Entwurf“ = `shop_config.require_printful_drafts` (Stufe ab „Nur Admins (Test)“, lesbarer Schlüssel), auch
bei ausgeschaltetem Notschalter – ein Entwurf wird nie produziert und nie bezahlt. „Notschalter“ =
`shop_config.require_printful_writes` (Schalter an, lesbarer Schlüssel).

**Bestätigen kann man beim Anlegen nicht:** `DraftOrder` hat kein Feld dafür, `create_draft` keinen Parameter, der
Rumpf (`order_payload`) besteht aus genau `external_id`, `shipping`, `recipient`, `order_items`, und die Anfrageschicht
verweigert den Weg `…/confirmation` außer aus `confirm_order`. Der Vertrag lehnt ein Feld `confirm` ab.

**Idempotenz beim Anlegen:** Vor dem Senden legt `create_draft` einen Claim in `shop_printful_drafts` an (eindeutiger
Index auf `external_id` = `lsw-<Bestellung>` aus `shop_orders`, bei Testentwürfen eine eigene). Nur wer den Insert
gewinnt, sucht über `@external_id` nach und sendet; ein zweiter Aufruf bekommt den Auftrag (Claim `created`) oder
`FulfillmentTransient` „läuft schon“ (`draft_in_progress`). Lehnt Printful mit 4xx ab, wird der Claim `failed` und die
`external_id` ist wieder frei. Ein Claim `sending` mit offenem Ausgang (Zeitüberschreitung, 5xx) wird nach 60 Sekunden
**erst nach einer Nachsuche** über `@external_id` und per bedingtem Update übernommen – gibt es den Auftrag, kommt er
zurück. Ein Claim `created`, dessen gespeicherte Nummer Printful nicht findet (404), wird nur übernommen, wenn
**alles** zutrifft: Abruf der Nummer `not_found`, Nachsuche über `@external_id` leer, und das letzte erfolgreiche
Lesen (`seen_at`, kein Rückfall auf `claimed_at`) liegt mit gültiger Zeit, nicht in der Zukunft, mehr als
**10 Minuten** zurück. Ein Claim `created` oder `deleting` ohne brauchbare Nummer wird nie übernommen:
`FulfillmentPermanent` `draft_claim_broken` („Entwurfs-Merkposten beschädigt – bitte in Printful prüfen“). Sonst
`FulfillmentTransient` `draft_unreadable` („Entwurf bei Printful gerade nicht lesbar – bitte gleich noch einmal“) –
ein kurz nicht lesbarer Auftrag (eventual consistency) führt so nie zu einem zweiten Entwurf. `delete_draft` setzt den
Claim erst auf `deleting`, löscht dann bei Printful und entfernt danach den Claim – die `external_id` ist sofort wieder
frei; lehnt Printful das Löschen ab, bleibt er `created`. Ein durch Abbruch hängender `deleting`-Claim braucht dieselbe
doppelte Prüfung (Nummer und `@external_id`), aber keine Schonfrist.

**Uhrzeiten:** Ein Claim gilt nur als „läuft noch“, solange sein Stempel jünger als die Frist ist **und** höchstens
60 Sekunden in der Zukunft liegt. Ein Stempel weiter in der Zukunft (vorgehende Uhr) gilt wie ein abgelaufener: beim
Anlegen erst nachsuchen, beim Bestätigen `unclear` – nie automatisch senden.

**Idempotenz beim Bestätigen:** Printful v2 kennt keinen Idempotenzschlüssel. `confirm_order` braucht einen eigenen
(8–128 Zeichen) und legt vor dem Senden einen Claim in `shop_printful_confirmations` an – eindeutig je Auftrag und je
Schlüssel; ein Schlüssel gehört zu genau einem Auftrag. Nur wer den Claim gewinnt, sendet, und nur, solange der
Auftrag ein Entwurf ist.

- **Eindeutige Ablehnung** (400, 409, 422): Claim frei, ein neuer Versuch darf senden.
- **Unklarer Ausgang** (Zeitüberschreitung, Netz, 5xx, 429, jede andere Antwort; ebenso ein Claim `sending`, der
  älter als fünf Minuten ist): Claim `unclear`, **kein automatisches erneutes Bestätigen**. Jeder weitere Aufruf liest
  nur nach: kein Entwurf mehr → bestätigt (Claim `confirmed`); weiter Entwurf → `FulfillmentPermanent`
  `confirm_unclear` („Bestätigung unklar – bitte in Printful prüfen“). Erneut senden nur ausdrücklich mit
  `force_after_review=True`, nachdem jemand in Printful nachgesehen hat – und nur einer übernimmt (bedingtes Update).
- Scheitert das Nachlesen vor dem Senden, ist nichts gesendet worden: der Claim wird wieder frei.

**Gegen Verwechslungen:** Produkt-, Varianten- und Auftragsnummer sind eigene Typen (`CatalogProductId`,
`CatalogVariantId`, `PrintfulOrderId`); eine bloße Zahl oder die falsche Nummer ist ein `TypeError`. Bestellt wird
immer eine **Variante** (`catalog_variant_id`), nie ein Produkt.

### Regeln

- Nur `https://api.printful.com`, keine Weiterleitungen (3xx ist ein Fehler), Zeitgrenze 15 s. Jede Methode baut ihren
  festen Weg; Nummern nur als Typ, `external_id` nur aus Buchstaben, Ziffern, `-` und `_`. Dateien und Druckflächen
  nur mit https-Adressen.
- **Rate-Limit:** Printful erlaubt 120 Aufrufe je Minute und Store. Jeder Client bleibt mit Luft darunter
  (`RATE_BUDGET_PER_MINUTE = 100` in jedem gleitenden 60-Sekunden-Fenster) und wartet sonst, statt in 429 zu laufen.
  `catalog_variants` braucht je Variante einen Preisaufruf; mit `price_for=(…)` holt es Preise nur für die angebotenen
  Varianten (`()` = keine) - ein Gildan 5000 hat Hunderte. Die Preisantwort liefert neben dem Preis je Technik den
  **Aufpreis je Druckfläche** (`placement_prices`, etwa Rückseite 5,25 €).
- Wiederholt wird nur Lesen: höchstens zweimal nach Zeitüberschreitung, Netzfehler, 429 oder 5xx (Pausen 1 s und 3 s).
  Bei 429 gilt `Retry-After` (Sekunden oder Datum); länger als 30 s wartet der Client nicht, sondern gibt den Wert im
  Fehler zurück (`retry_after`). Schreiben wird nie still wiederholt.
- Der Schlüssel steht nur im Kopf `Authorization: Bearer …`. Meldungen sind feste Sätze; was Printful zu einem
  Datenfehler sagt, steht gekürzt in `provider_detail` (Schlüssel entfernt, Mail-Adressen gekürzt). Logs nur über
  `log_safe`, mit Methode, Operation, Ursache und Status.
- Die Kostenschätzung sendet nur Land und PLZ, nie Name oder Straße.
- Schlüssel auf Kontoebene brauchen `X-PF-Store-Id` (`PrintfulClient(…, store_id=…)`); `from_db` setzt keinen –
  darum einen **Schlüssel für genau den Vereins-Store** anlegen.

### Fehlerklassen

| Klasse | Wann | Was tun |
| --- | --- | --- |
| `FulfillmentTransient` | Zeitüberschreitung, Netz, 429, 5xx, Schätzung noch nicht fertig, Entwurf oder Bestätigung läuft schon | später erneut versuchen (`retry_after`) |
| `FulfillmentPermanent` | 401, 403, 404, Weiterleitung, unerwartete Antwort, kein Schlüssel, Bestätigung unklar (`confirm_unclear`), Merkposten beschädigt (`draft_claim_broken`) | Admin informieren |
| `FulfillmentInvalid` | 400, 409, 422, gescheiterte Schätzung, kein Entwurf mehr, Schlüssel gehört zu anderem Auftrag | Bestellung blockieren |

Alle erben von `FulfillmentError` mit `kind`, `reason`, `status`, `retry_after` und `provider_detail`.

### Schlüssel bei Printful

Einen **privaten Schlüssel für den Vereins-Store** anlegen (Printful → Developers → Tokens), mit diesen Rechten:

| Recht (Scope) | Wofür |
| --- | --- |
| `orders` | Entwurf anlegen, lesen, löschen, bestätigen; Kostenschätzung |
| `file_library` | Druckdateien hinterlegen und lesen |
| `webhooks` | Webhooks einrichten (#1720) |
| – | Katalog: ohne eigenes Recht. Mockups: Printful nennt kein eigenes Recht – beim ersten echten Test mit `GET /v2/oauth-scopes` prüfen |

`sync_products` und `product_templates` braucht der Shop nicht. Ablaufdatum des Schlüssels im Kalender vormerken.

### Webhook-Signatur

`verify_webhook_signature(rumpf_bytes, kopf_x_pf_webhook_signature, secret_key_hex)`: HMAC-SHA256 über den
**unveränderten** Rumpf, Schlüssel = `secret_key` aus der Webhook-Einrichtung (Hex-Text, wird zu Bytes dekodiert),
Vergleich in konstanter Zeit. Fehlt etwas oder passt es nicht, ist das Ergebnis `False` – nie eine Ausnahme. Das
Geheimnis gehört verschlüsselt in die Shop-Einstellungen (#1720).

### Tests

`backend/tests/test_printful_client_unit.py` gegen den Fake: Katalog, Schätzung, Entwurf (auch: Anlegen bestätigt
nie), Bestätigen mit Notschalter und Idempotenz, Dateien, Mockups, Signatur, jede Fehlerklasse, Wiederholen mit
`Retry-After`, kein Schlüssel in Fehlern und Logs, Aufpreis je Druckfläche, Preise nur für gewählte Varianten und das
Rate-Limit. Produktverwaltung und Abgleich: `test_shop_products_unit.py` und `test_shop_products_flow.py`, ebenfalls
gegen den Fake. Es gibt **keine** echten Aufrufe an Printful. Die Abnahme gegen das
echte Printful (Entwurf und Schätzung anlegen, nicht bestätigen) macht der Obmann mit der Testansicht aus #2062.

