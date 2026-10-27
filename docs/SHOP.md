# Vereinsshop

Stand: Fundament aus #1703 (Datenmodell) und #1704 (Rechte, Protokoll), dazu Stufen, Notschalter und Preise aus
#1706 (Abschnitt „Einstellungen“ unten), Designs/Druckdateien aus #1708 (Abschnitt „Designs und Druckdateien“) und
der Printful-Adapter aus #1705 (Abschnitt „Printful-Adapter“), die Produktverwaltung aus #1707 mit dem Katalogabgleich
aus #1709 (Abschnitt „Produktverwaltung und Katalogabgleich“) und die Druckvorlagen von Printful mit selbst erzeugten
Druckdateien aus #2069 (Abschnitt „Druckvorlagen und Druckdateien“), Teil des Epics #1699. Der Shop ist **von außen
unsichtbar**: Es gibt keine Seiten für Mitglieder und nur eine öffentliche Route - die Druckdateien für Printful hinter
einem Zufallsschlüssel; im Admin steht er unter Finanzen → Shop. Steuer (#1701) und die Shop-Seiten (#1712 ff.) folgen.

Code: `backend/services/shop_common.py` (Fehler, Anschriften, Protokoll, personenbezogene Felder),
`shop_catalog.py` (Katalog), `shop_designs.py` (Druckdateien, #1708), `shop_motifs.py` (Motive mit Fassung für dunkle
und helle Shirts, #2069; SVG über den gemeinsamen Baustein `svg_safe.py`), `shop_orders.py` (Bestellungen, Ereignisse,
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
| `shop_designs` | Druckdatei des Vereins je Fassung: `design_key`, `version` (zählt hoch), `file_ref`, `sha256`, Druckposition; seit #1708 dazu `public_id` (Zufallsschlüssel der öffentlichen Adresse), Pixel, DPI und Druckmaße in Zoll, mit denen sie geprüft wurde, Transparenz, Ausgangsformat und `public_disabled_at` (Aufbewahrung); seit #2069 die Fassung (`variant`: `dark` für dunkle, `light` für helle Shirts), Herkunft (`origin`: `upload` oder `auto_light`), bei SVG das bereinigte SVG (`svg_ref`, nie öffentlich), erkannte Farben (`colors`) und `view_box`, bei einer umgefärbten Fassung `derived_from` und `recolor`. Alte Fassungen bleiben | `design_key` + `version`; `public_id` |
| `shop_design_profiles` | Design bzw. Motiv (#1708, #2069): Titel, Platzierung, feste **Shirtfarben** (`garment_colors`, freiwillig), Notiz, `version`; seit #2069 `light_mode` (`auto` oder `file`), `light_auto` (Stand der automatischen Fassung) und Ausnahmen je Shirtfarbe (`color_variants`) | `design_key` |
| `shop_gamertag_files` | Gamertag-Druckdatei (#1711): Herkunft `gamertag`, Zweck (`test`, `order`), `sha256`, `file_ref`, `public_id`, Maße, Anker, Farbe, `rules_hash`; bei Bestelldateien Konto, Bestellung und Position (personenbezogen: das PNG zeigt den Namen) - nie der Name als Text | `purpose` + `sha256` (nur Testdateien); `public_id` |
| `shop_print_templates` | Druckvorlage je Printful-Produkt (#2069): Maße je Fläche, Technik und Gruppe (`entries`), Vorlagenbilder (`previews`), `hash` der Maße, `changes` mit `changed_at`, `checked_at`, `last_error` | `printful_product_id` |
| `shop_print_files` | Druckdatei je Produkt, Fläche, Farbe und Gruppe (#2069): Herkunft (`composed`, `upload`), Zweck (`base` mit `version`, `order` je Bestellposition), `sha256`, `file_ref`, `public_id`, Maße, `layout_hash`, `template_hash`, Quellen; bei Bestelldateien Konto, Bestellung und Position (personenbezogen) | `public_id`; Produkt + Fläche + Gruppe + Farbe + Version (nur `base`) |
| `shop_printful_catalog` | Zwischenstand des Printful-Katalogs für die Produktsuche (#2069): Produkte, Kategorien, `fetched_at` - keine Person | `id` |
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
  Seit #2069 je Druckfläche genau eine Druckdatei (`print_files`: Grunddatei oder eigene mit Gamertag, Abschnitt „Druckvorlagen und Druckdateien“), dazu die Motiv-Fassungen (`designs`). Bis #2069 je Platzierung (`designs`): Platzierung, Art, Printful-Druckfläche, Technik, Position in Zoll und die
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

Migration 13 `shop_data_model` legt die Shop-Indizes einmal an und steht danach in `schema_migrations`. Migration 14
`shop_motif_variants` (#2069) macht aus Designs Motive - Trockenlauf und Rückweg im Abschnitt
[Motive](#motive-2069).

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
| `POST /api/admin/shop/products` | Produkt anlegen (nur Titel Pflicht, immer Entwurf; Grund optional) |
| `GET /api/admin/shop/products/{id}` | Produkt mit allem für den Aufbau (#1707, Abschnitt unten) |
| `PATCH /api/admin/shop/products/{id}` | Grunddaten ändern (Grund optional) - nie den Stand |
| `POST /api/admin/shop/products/{id}/variants` | Variante anlegen (Grund optional) |
| `PATCH /api/admin/shop/variants/{id}` | Variante ändern (Grund optional) |
| `GET /api/admin/shop/orders` | Bestellungen lesen – ohne Anschriften |
| `GET /api/admin/shop/orders/{id}` | Bestellung mit Positionen, Anschriften und Verlauf |

`scripts/check-code-patterns.py` (Regel 3) hält fest: Jede Route mit `shop` im Pfad liegt unter `/api/admin/shop`
und hängt an `require_area("finance")`. Öffentlich ist nur, was in `PUBLIC_SHOP_ROUTES` mit Methode, genauem Pfad,
Datei und Begründung steht - bisher allein `GET /api/shop/print-files/{public_id}/{filename}` (#1708; seit #2069
liefert sie auch die erzeugten Druckdateien aus `shop_print_files`). Jede andere
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
| `shop.design.profile` | Design angelegt bzw. Titel, Shirtfarben (vorher/nachher), Ausnahmen je Shirtfarbe (vorher/nachher, #2069) oder Notiz geändert (#1708) |
| `shop.design.light`, `shop.motif.settings` | Fassung für helle Shirts auf eigene Datei bzw. zurück auf automatisch; Ersatzfarbe oder Helligkeits-Schwelle, vorher/nachher (#2069) |
| `shop.design.placement` | Druckbreite, Druckbereich oder Mindest-DPI einer Platzierung, vorher/nachher (#1708) |
| `shop.product.catalog`, `shop.product.offer` | Printful-Produkt gewählt (vorher/nachher), Farben und Größen angeboten (#1707) |
| `shop.product.placements`, `shop.product.designs` | Platzierungen mit Position (vorher/nachher), Design je Platzierung und Farbe (#1707) |
| `shop.product.status` | Stand vorher/nachher mit Prüfergebnis; auch „zurück auf Entwurf“ nach einer Änderung (#1707) |
| `shop.product.layout`, `shop.print_file.add` | Druckflächen geändert bzw. Umstellung (vorher/nachher); Druckdatei erzeugt oder hochgeladen (#2069) |
| `shop.print_template.change`, `shop.print.presets` | Printful hat Maße einer Fläche geändert; Positions-Vorgaben oder Regeln geändert (#2069) |
| `shop.catalog.sync` | Abgleich mit Printful: gesperrte, freigegebene Varianten, Preisänderungen - nur wenn sich etwas ändert (#1709) |
| `shop.gamertag.rules`, `shop.gamertag.file` | Regeln der Gamertag-Druckdatei (vorher/nachher) bzw. Testdatei mit Prüfsumme und Maßen - nie mit dem Namen (#1711) |
| `shop.order.release`, `shop.order.printful_confirm`, `shop.order.cancel` | vorgesehen für #1718, #1721 |
| `shop.order.club`, `shop.order.prize` | vorgesehen für #1724, #1726 |
| `shop.config` | Einstellungen geändert (#1706): Stufe, Freigabe „Steuer geklärt“, Notschalter, Preise, Printful-Schlüssel – mit vorher und nachher, nie mit Schlüssel |

**Menü:** Verwaltung → Finanzen → **Shop** (`/admin/shop`, #1706) - ein Menüeintrag mit Reitern: **Einstellungen**
(`/admin/shop`), **Produkte** (`/admin/shop/products`, #1707), **Motive** (`/admin/shop/designs`, #1708, seit #2069 „Motive“ statt „Designs“) und **Gamertag** (`/admin/shop/gamertag`, #1711). Der
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
| `PATCH /api/admin/shop/config` | Stufe, Notschalter, öffentlicher Aufschlag, Ersatzpauschale, Mindestpreis (mit Grund) |
| `PUT /api/admin/shop/config/tax-clearance` | „Steuer geklärt“ setzen oder zurücknehmen (nur Superadmin, mit Grund) |
| `PUT /api/admin/shop/config/printful-key` | Schlüssel hinterlegen (zusätzlich System, mit Grund) |
| `POST /api/admin/shop/config/printful-key/remove` | Schlüssel entfernen (zusätzlich System, mit Grund) |
| `POST /api/admin/shop/config/printful-test` | Verbindung testen (nur lesen) |

Neue Umgebungswerte braucht es nicht: der Schlüssel liegt verschlüsselt in der Datenbank. Offen aus #1706: der
Abschnitt „Zahlungsbedingungen für den Shop“ (Dolibarr-Zahlungsbedingungen, Erinnerungen) folgt in einem eigenen Paket.


## Designs und Druckdateien (#1708)

Code: `backend/services/shop_designs.py`, Routen `backend/routes/shop_design_routes.py` (Admin) und
`shop_print_file_routes.py` (öffentlich für Printful), Seite `frontend/src/pages/admin/AdminShopDesignsPage.jsx`
(Verwaltung → Finanzen → Shop → Reiter **Motive**). Käufer laden nie etwas hoch; Druckdateien kommen nur von den
Finanzen. Seit #2069 ist ein Design ein **Motiv** mit Fassungen für dunkle und helle Shirts, SVG bevorzugt - Abschnitt
[Motive](#motive-2069).

**Upload** (nur Finanzen mit Zwei-Faktor, mit Grund, Protokoll `shop.design.add`):

- **PNG oder JPG**, höchstens 50 MB (`SHOP_DESIGN_MAX_MB`) und 40 Millionen Pixel, seit #2069 auch **SVG** (bis 2 MB,
  streng bereinigt, auch als `.png` getarnt wird es als SVG geprüft). WebP, GIF, PDF, animierte PNG und
  16-Bit-Graustufen werden mit Text abgelehnt.
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
die Variante ohne Druckdatei. **Seit #2069 ist die Liste freiwillig:** die Fassung je Shirtfarbe wählt die Helligkeit
(Abschnitt [Motive](#motive-2069)); eine Farbe in `garment_colors` druckt wie bisher immer die Hauptdatei.

| Route (alle `require_area("finance")`) | Zweck |
| --- | --- |
| `GET /api/admin/shop/designs` | Motive mit Versionen, Ampel, Adressen, Zustand für helle Shirts; Druckbereiche je Platzierung; Ersatzfarbe und Schwelle |
| `POST /api/admin/shop/designs/upload` | Datei hochladen (Formular: `file`, `design_key`, `reason`, `variant` `dark`/`light`; neues Motiv dazu `title`, `placement`, freiwillig `garment_colors`) |
| `PATCH /api/admin/shop/designs/{design_key}` | Titel, feste Shirtfarben, Ausnahmen je Shirtfarbe (`color_variants`), Notiz (Grund optional) |
| `POST /api/admin/shop/designs/{design_key}/light-auto` | Fassung für helle Shirts zurück auf automatisch bzw. jetzt erzeugen (#2069) |
| `PUT /api/admin/shop/designs/motif-settings` | Ersatzfarbe `light_ink` und Helligkeits-Schwelle `threshold` (#2069) |
| `PUT /api/admin/shop/designs/placements/{placement}` | Druckbreite, Druckbereich, Mindest-DPI in Zoll (Grund optional) |

Nicht in #1708: der Editor mit Ebenen, Hilfslinien und Drag-and-drop (Teil 2), die Gamertag-Druckdatei (#1711),
Mockups (#1710) und das Hochladen zu Printful (#1705).

## Motive (#2069)

Code: `backend/services/svg_safe.py` (gemeinsamer SVG-Baustein, auch für das Branding), `backend/services/shop_motifs.py`
(Fassungen, Shirtfarbe → Fassung, Upload und Ansicht für den Admin, Schnittstelle für Druckdateien, Migration 14) auf
den Bausteinen in `shop_designs.py` (Ablage, Prüfung, Versionen), Seite `AdminShopDesignsPage.jsx` (Reiter **Motive**). Ziel des Obmanns (27.10.2026): die
Vereinslogos als echte Vektor-SVGs einmal hochladen, die Fassung für helle Shirts entsteht automatisch. Mitglieder und
Benutzer laden weiter nur PNG/JPG (Bild-Uploads ohne SVG, [BETRIEB.md](BETRIEB.md)).

**Ein Motiv, zwei Fassungen.**

- **Für dunkle Shirts** (`variant = "dark"`) ist die Hauptdatei: SVG bevorzugt, PNG/JPG wie bisher.
- **Für helle Shirts** (`variant = "light"`) gilt die eigene Datei, wenn es eine gibt (`light_mode = "file"`, hat
  Vorrang), sonst die automatische Fassung (`light_mode = "auto"`, Vorgabe): Weiß (`#ffffff`) wird durch die
  **Ersatzfarbe** ersetzt (Vorgabe `#111111`, einstellbar), alle anderen Farben - etwa das Vereinsblau `#27aae1` -
  bleiben. Bei SVG über `svg_safe.recolor`; bei PNG nur, wenn es sauber geht: durchsichtiger Hintergrund und keine
  Grautöne (sonst der Hinweis „bitte eigene Datei für helle Shirts“). Enthält ein Motiv kein Weiß, gilt die Hauptdatei
  auch für helle Shirts.
- Jede Fassung ist eine eigene **Version** (`origin`: `upload` oder `auto_light`, bei automatischen `derived_from`
  und `recolor`) mit Prüfsumme, Datei und Zufallsadresse wie in #1708; die Nummer zählt über beide Fassungen.
  `shop_catalog.latest_design` liefert nur die Hauptdatei. Eine neue Hauptdatei oder Ersatzfarbe erzeugt eine neue
  automatische Fassung; Bestellungen behalten ihre Version. Die Aufbewahrung rechnet je Fassung.
- Ein SVG wird für die Druckdatei mit der Druckbreite der Platzierung und mindestens 300 DPI (bzw. 120 % der Mindest-DPI)
  gerastert; das bereinigte SVG liegt daneben (`UPLOAD_DIR/shop-designs/<zufällig>.svg`) und wird **nie** ausgeliefert -
  die Adresse für Printful liefert nur `*.png`.

**SVG: strenge Bereinigung** (`svg_safe.sanitize`, Vorgabe `strict=True`).

- Gelesen mit `defusedxml`: DOCTYPE, Entities (XXE, „Billion Laughs“) und externe DTDs lehnt der Leser ab.
- Positivliste der Elemente: `svg`, `g`, `defs`, `symbol`, `title`, `desc`, `path`, `rect`, `circle`, `ellipse`,
  `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `mask`, `use` (nur `#id`) und
  `style` (Regel für Regel neu gebaut), dazu die üblichen Darstellungsattribute; Werte werden nach ihrer Art geprüft,
  `url()` und `href` nur auf `#id`. Unbekanntes Harmloses (Metadaten von Inkscape oder Illustrator) fällt still weg.
- **Abgelehnt mit Fund** (feste Wörter, nie Text aus der Datei): eingebettetes Pixelbild (`<image>`, „Kein echtes
  Vektor-SVG – enthält ein Pixelbild.“), Skript (`<script>`, `javascript:`), Ereignis-Attribute (`on…`),
  eingebettetes HTML (`foreignObject`, `iframe`), Verweise nach außen (`href`, `xml:base`, XInclude,
  Stylesheet-Anweisung), eingebettete Daten (`data:`), Stylesheet mit `@import`, `@font-face`, `url()` nach außen oder
  Ausdrücken, und Schrift als Text (für den Druck in Pfade umwandeln - so zeichnet jeder Rechner gleich).
- Grenzen: 2 MB (`MAX_SVG_UPLOAD_MB`, zu groß: 413), 4000 Elemente (auch über `use` vervielfacht), Tiefe, Masken,
  Pfadzahlen; Zeichnen in eigenem Prozess mit Zeit- und Speichergrenze ([BETRIEB.md](BETRIEB.md)).
- Gespeichert wird nur die neu geschriebene Fassung. Das Branding nutzt denselben Baustein **nachsichtig**
  (`strict=False`: Gefährliches fällt still weg) - bis der Umbau der Logo-Felder (#2073) auf streng umstellt.

**Umfärben, Analyse, Rastern** (`svg_safe`):

- `recolor(svg, {"#ffffff": "#111111"})` ersetzt in `fill`, `stroke`, `stop-color` und `color` - als Attribut, im
  `style`-Attribut und im `<style>`-Block, nie in Selektoren, Kennungen oder `url(#…)`. `#fff`, `#FFFFFF`, `white` und
  `rgb(255,255,255)` gelten als dieselbe Farbe; Alpha bleibt.
- `analyze(svg)`: angenommen ja/nein mit Funden, echtes Vektor-SVG ja/nein, viewBox, Seitenverhältnis, Farben
  (häufigste zuerst; Formen ohne Füllangabe zeichnet ein SVG schwarz, die stehen nicht in der Liste).
- `rasterize(svg, width_px=…)` bzw. `height_px=…`, `dpi=…`: PNG in genau dieser Größe, Seitenverhältnis erhalten,
  Hintergrund durchsichtig, im PNG nur die DPI, ohne Systemschriften; gleiche Eingabe, gleiche Bytes.

**Shirtfarbe → Fassung.** `shop_motifs.variant_for_garment(farbwert, color=…, threshold=…, exceptions=…)` liefert
`dark` oder `light`: eine **Ausnahme** mit demselben Farbnamen geht vor (am Motiv, `color_variants`, danach die festen
Shirtfarben `garment_colors` mit der Hauptdatei), sonst die **relative Luminanz** des Printful-Farbwerts
(`color_code`) gegen die Schwelle (Vorgabe 0,18 - darunter Schwarz, Navy, Rot, Royal; darüber Weiß, Grau meliert,
Gelb). Ohne Farbwert und ohne Ausnahme gilt die Hauptdatei wie vor #2069. `file_for_garment(db, motiv, color=…,
color_hex=…)` liefert die Version - die Bestellung (`shop_orders`, mit Platzierungen wie über die ältere
Einzel-Druckdatei `design_key`) friert genau diese ein, die Vorab-Prüfung der Produktverwaltung prüft genau diese.
Wurde für ein Motiv noch nie eine Fassung für helle Shirts erzeugt (Designs von vor #2069), druckt es wie bisher die
Hauptdatei; sonst ist eine Farbe ohne passende Fassung nicht bestellbar.

**Einstellungen** (Dokument `settings` mit `id = "shop_motifs"`, Protokoll `shop.motif.settings` mit
vorher/nachher): Ersatzfarbe `light_ink` (`#rrggbb`, nicht Weiß) und Schwelle `threshold` (0,02 bis 0,9). Eine neue
Ersatzfarbe erzeugt die automatischen Fassungen aller Motive neu.

**Schnittstelle für die Druckdateien (Teil B):**

```python
png = await shop_motifs.render_motif_png(db, "loewe", "light", width_px=1800, dpi=150)          # geltende Fassung
png = await shop_motifs.render_motif_png(db, "loewe", "light", width_px=1800, dpi=150, version=7)  # eingefroren
info = await shop_motifs.motif_info(db, "loewe", "light")  # Version, Format, is_vector, Pixel, Seitenverhältnis
variant = shop_motifs.variant_for_garment("#0c0c0c", color="Black", threshold=..., exceptions=...)
```

- Transparentes PNG in genau `width_px` Breite, Seitenverhältnis erhalten, im PNG nur `dpi`; deterministisch (gleiche
  Version und Größe, gleiche Bytes). SVG-Fassungen werden aus dem bereinigten SVG neu gerastert (scharf in jeder
  Größe), PNG-Fassungen skaliert - wie fein das ist, sagt `motif_info` (Pixel der gespeicherten Datei).
- `variant`: `dark` oder `light` (eigene Datei, automatische Fassung oder - ohne Weiß - die Hauptdatei).
- `LookupError`, wenn es die Fassung nicht gibt (etwa „für helle Shirts“ bei einem PNG, das sich nicht umfärben
  ließ); `ValueError` bei unsinnigen Eingaben (Variante, Breite 1 bis 20000, DPI 1 bis 2400). Asynchron; gerastert
  wird in einem eigenen Prozess (`svg_raster_worker.py`).

**Admin, Reiter Motive.** Je Motiv nebeneinander die Vorschau auf dunklem Shirt (Schwarz) und hellem Shirt (Hellgrau),
dazu Format („echtes Vektor-SVG“ oder PNG/JPG), erkannte Farben, Maße, Ampel, Zustand für helle Shirts (eigene Datei,
automatisch, Hauptdatei, fehlt, noch nicht erzeugt) und der Versionsverlauf mit Fassung und Herkunft. Upload per Ziehen
und Loslassen oder Klicken, mit Wahl der Fassung; ein abgelehntes SVG zeigt am Formular, was gefunden wurde. Knöpfe
„Eigene Datei für helle Shirts“, „Hell-Variante erzeugen“ bzw. „Zurück auf automatisch“, Ausnahmen je Shirtfarbe und
die Einstellungen mit Beispiel-Shirtfarben. Der Grund ist überall optional.

**Migration 14 `shop_motif_variants`** (läuft beim Start einmal; seit #2065 können in Produktion Designs liegen):

- Zuerst bekommen Designs „Hell-Variante automatisch“, und die bisherigen festen Zuordnungen - die Farbliste eines
  Designs und jede Zelle „Farbe → Design“ in den Produkten - werden **Ausnahmen „Hauptdatei“**: jede bisher zugeordnete
  Farbe druckt weiter die Datei, die sie hatte, auch eine helle Farbe. Erst danach werden Fassungen ohne Variante „für
  dunkle Shirts“. Vor und während der Migration druckt ein Design ohne erzeugte Hell-Fassung ohnehin die Hauptdatei -
  eine Bestellung im Zwischenstand scheitert nicht.
- Übernommen wird jede Zuordnung, **nie gekappt**. Im Admin sind je Motiv bis zu 200 Ausnahmen speicherbar (ein Produkt
  hat höchstens 80 Varianten); hat ein Motiv aus mehreren Produkten mehr, nennt der Trockenlauf es mit „ACHTUNG“.
- Neue automatische Fassungen entstehen nicht von selbst; „Hell-Variante erzeugen“ am Motiv.
- Mehrfach aufrufbar. Werkzeug mit Trockenlauf und Rückweg:

```bash
docker compose exec backend python scripts/shop_motifs.py                       # Trockenlauf: was sich ändert
docker compose exec backend python scripts/shop_motifs.py --anwenden            # anwenden (wie der Start)
docker compose exec backend python scripts/shop_motifs.py --abbauen             # Rückweg ansehen
docker compose exec backend python scripts/shop_motifs.py --abbauen --anwenden  # Rückweg ausführen
```

Der Rückweg entfernt Varianten, Einstellungen und Ausnahmen und trägt Migration 14 aus - nur, solange es **keine
Fassung für helle Shirts** gibt (die ältere Version würde sie als neueste Hauptdatei nehmen); sonst verweigert er
(Rückgabe 1). Farblisten und Dateien bleiben. Danach die ältere Version einspielen; sonst wendet der nächste Start die
Migration wieder an.

**Rechte:** wie alle Shop-Routen nur Finanzen mit Zwei-Faktor (Regel 3); das Branding bleibt bei seinen Rechten.

Offen für Teil B: Druckvorlagen je Produkt aus der Printful-API, Positions-Vorgaben und der Generator, der
`render_motif_png` in die Druckfläche setzt (dann wählt die Produktverwaltung je Platzierung nur noch das Motiv).
Offen für #2073: die Logo-Felder des Brandings auf `svg_safe` streng umstellen und die Hell-Variante dort nutzen.

## Produktverwaltung und Katalogabgleich (#1707, #1709)

Code: `backend/services/shop_products.py` (Aufbau, Prüfung, Stand, Ansicht), `shop_catalog_sync.py` (Abgleich),
`shop_costs.py` (Selbstkosten aus Einkauf und Aufpreisen),
Routen `backend/routes/shop_product_routes.py` (Schritte) und `shop_admin_routes.py` (Anlegen, Grunddaten, Lesen),
Seite `frontend/src/pages/admin/AdminShopProductsPage.jsx` (Verwaltung → Finanzen → Shop → Reiter **Produkte**).
Beispiel aus #2062: Gildan 5000 schwarz mit Löwe vorne rechts, Gamertag vorne links und Rückenlogo.

**Fünf Schritte** - jeder im Protokoll (Person, Zeit, was), jede Antwort die volle Ansicht samt Vorab-Prüfung. Der
Grund ist optional, **Pflicht nur beim Veröffentlichen** - dann geht das Produkt live (Entscheidung Obmann 27.10.2026):

1. **Produkt wählen:** Grunddaten (Titel, Beschreibung - bereinigt -, Sichtbarkeit, Personalisierung) und die
   Printful-Produkt - gefunden über die **Produktsuche** (Name, Marke, Modell, Kategorie oder Dashboard-Link, #2069),
   die Nummer von Hand nur im Notfall. Ein Produkt je Modell; Farben und Größen kommen in Schritt 2. Die Website lädt
   über den Adapter Produkt und Varianten (Größe, Farbe, Variantennummer, Lager, Druckflächen mit Maßen) und speichert
   einen Abzug - **ohne Preise** -, dazu die Druckvorlagen (#2069). Eine Variantennummer als Produktnummer findet
   Printful nicht - die Meldung sagt das. Ein anderes Printful-Produkt setzt Angebot und Technik zurück; vorhandene
   Varianten bleiben (Bestellungen zeigen auf sie), werden aber inaktiv.
2. **Farben und Größen:** Technik, Farben, Größen. Je Farbe × Größe eine Variante (SKU `PF<Printful-Variante>-<Produkt>`)
   mit Zuordnung zur Printful-Variante; danach holt der Abgleich die Einkaufspreise **nur für diese** (höchstens 80 je
   Produkt - je Variante ein Preisaufruf).
3. **Druckflächen** (seit #2069, Abschnitt „Druckvorlagen und Druckdateien“): je Printful-Fläche aus der Druckvorlage
   Motiv, Vorgabe-Position aus der Liste und Größe in cm; Gamertag bzw. Vereinsnummer als Platzhalter (Datei je
   Bestellung) nur mit passender Personalisierung. „Druckdateien erzeugen“ baut je Farbe die Datei in der exakten
   Pixelgröße von Printful. Die festen Zoll-Positionen von #1707 sind abgelöst.
4. **Preise:** Mitgliederpreis = **Selbstkostenpreis**: Einkauf der Variante (Technik) plus Aufpreis jeder weiteren
   Printful-Druckfläche; eine Fläche steckt im Grundpreis (`included_placement`, Vorgabe `front`). Ohne Aufschlag.
   Öffentlicher Preis = Einkauf plus Aufschlag als Vorschlag; der eigene Aufschlag des Produkts ersetzt den
   allgemeinen. „Preise übernehmen“ schreibt die Selbstkosten in die Varianten - nur so kommen Preise von Printful in
   den Shop. Ob die Fläche im Grundpreis stimmt, zeigt die Kostenschätzung im Testentwurf (#2062).
5. **Prüfen und veröffentlichen:** Entwurf → **geprüft** → **veröffentlicht** → archiviert.

**Vorab-Prüfung** (`run_check`): Printful-Produkt geladen und nicht eingestellt; Farben und Größen gewählt;
Druckvorlage geladen und aktuell; Sichtbarkeit und Personalisierung passen zu den Platzhaltern; mindestens eine Fläche
mit Motiv; **jede angebotene Farbe hat an jeder Fläche eine gültige Druckdatei zum aktuellen Aufbau und zur aktuellen
Vorlage** (sonst nennt die Prüfung Fläche und Farbe, #2069); alle angebotenen Varianten lieferbar; Preis berechnet und übernommen, ohne offene Preiswarnung und nicht
unter dem **Mindestpreis** (Einstellung `min_price_cents`, Vorgabe 1 €, unter Shop → Einstellungen → Preise). Dazu die
**Mockup-Prüfung**: bis #1710 „offen“. „Geprüft“ braucht alles außer den Mockups, „veröffentlicht“ alles - bis #1710
lässt sich also nichts veröffentlichen.

**Regeln:** Den Stand ändert nur `POST …/status` (ein gewöhnliches Speichern lehnt `status` ab). Ein geprüftes Produkt
fällt bei jeder Änderung des Aufbaus (auch der Personalisierung) zurück auf „Entwurf“; ein veröffentlichtes ändert man
erst nach dem Zurückziehen - nur „Preise übernehmen“ geht auch veröffentlicht. Archivierte Produkte bleiben lesbar.
„Öffentlich“ plus Personalisierung lehnt der Server immer ab.

**Die alten Wege halten dieselben Regeln** (`PATCH /products/{id}`, `POST /products/{id}/variants`,
`PATCH /variants/{id}`, Printful-Zuordnung von Hand): veröffentlicht oder archiviert nur Titel und Beschreibung (sonst
409 „erst zurückziehen“); jede andere Änderung setzt „geprüft“ auf „Entwurf“ zurück; bei Printful-Produkten Preise nur
über „Preise übernehmen“ und Varianten nur über „Farben und Größen“ (400). Kein Verkaufspreis unter dem Mindestpreis -
auch nicht 0 € (400), beim Anlegen wie beim Ändern; `place_order` nimmt ihn ebenfalls nicht. „Preise übernehmen“ lehnt
Selbstkosten unter dem Mindestpreis ab („Selbstkosten 15,00 € liegen unter dem Mindestpreis 20,00 € …“) und übernimmt
dann gar nichts.

**Nacheinander:** Jeder Schritt des Aufbaus hält eine kurze MongoDB-Sperre je Produkt
(`shop_catalog.product_lock`, `shop:product:<id>`, über alle Prozesse). Jede Admin-Änderung erhöht die `version` des
Produkts.

**Abgleich** (`shop_catalog_sync`): auf Knopfdruck („Mit Printful abgleichen“) und täglich um 05:20 Wiener Zeit
(Scheduler-Job `shop_catalog_sync`, alle nicht archivierten Produkte mit Printful-Produkt, ohne Schlüssel nichts).

- **Fail-closed:** gesperrt (`blocked_reason`) wird, was Printful nicht als „in stock“ meldet, wofür Printful gar
  nichts meldet („Lager bei Printful unbekannt.“), was nicht mehr im Katalog steht und wofür der Einkauf fehlt oder 0 €
  ist („Preis fehlt bei Printful.“), und deren Selbstkosten unter dem Mindestpreis liegen (ein veröffentlichtes
  Produkt verkauft nie still darunter weiter). Nur „in stock“ mit gültigem Preis hebt die Sperre auf. `place_order` prüft bei
  Printful-Produkten die Sperre **und** `in_stock is True` der Zuordnung.
- Preisänderung: neuer Einkauf an der Zuordnung plus `price_warning` (vorher/nachher, seit) - der Preis der Variante
  bleibt, bis die Finanzen übernehmen. Bestehende Bestellungen haben ihre Preise eingefroren.
- Ausfall: nichts ändert sich; `catalog_sync` merkt Zeitpunkt, Ursache und `last_ok_at` - der Admin zeigt den letzten
  Stand mit Datum.
- **Kein alter Stand:** Printful wird ohne Sperre gefragt; geschrieben wird danach unter der Produkt-Sperre und nur,
  wenn die `version` des Produkts noch die gelesene ist. Sonst verwirft der Abgleich sein Ergebnis („Abgleich
  übersprungen: das Produkt wurde gerade geändert“, `catalog_sync.skipped`).
- **Einer zur Zeit:** Sperre `shop:catalog-sync` mit Ablauf (900 s, wird erneuert); ein zweiter Abgleich bekommt 409
  „läuft gerade“, der Tagesjob überspringt. Je angebotener Variante ein Preisaufruf, gemeinsames Rate-Limit (oben).
- **Alle Produkte:** der Tagesjob geht seitenweise (`PAGE_SIZE = 200`) über alle nicht archivierten Printful-Produkte.

| Route (alle `require_area("finance")`) | Zweck |
| --- | --- |
| `POST /api/admin/shop/products/{id}/printful` | Schritt 1: Printful-Produkt laden (`printful_product_id`) |
| `PUT /api/admin/shop/products/{id}/offer` | Schritt 2: Technik, Farben, Größen - danach Preise |
| `GET /api/admin/shop/printful-catalog` | Schritt 1: Produktsuche (`q`, `category_id`, `link`, `refresh`, #2069) |
| `PUT /api/admin/shop/products/{id}/layout` | Schritt 3: Druckflächen mit Motiv, Vorgabe, Größe und Platzhaltern, Fläche im Grundpreis (#2069) |
| `POST /api/admin/shop/products/{id}/layout/preview` | Schritt 3: Pläne für den ungespeicherten Aufbau (Fassung je Farbe, Bild, Rahmen) - speichert nichts; je Konto höchstens `SHOP_LAYOUT_PREVIEW_LIMIT` Aufrufe (Vorgabe 60) je `SHOP_LAYOUT_PREVIEW_WINDOW_SECONDS` (Vorgabe 60 s), darüber 429 (#2069) |
| `POST /api/admin/shop/products/{id}/print-files` | Schritt 3: Druckdateien erzeugen (#2069) |
| `POST /api/admin/shop/products/{id}/print-templates/refresh` | Druckvorlagen neu von Printful (#2069) |
| `GET /api/admin/shop/products/{id}/preview` | Vorschau einer Fläche je Farbe als PNG (#2069) |
| `GET /api/admin/shop/products/{id}/print-files/{file_id}` | Grunddatei ansehen (#2069) |
| `POST /api/admin/shop/print-files/upload` | Fertige Druckdatei für Profis (#2069) |
| `GET`/`PUT /api/admin/shop/print-presets` | Positions-Vorgaben und Regeln (#2069) |
| `GET /api/admin/shop/print-templates/{printful_product_id}/images/{index}` | Vorlagenbild über die Website (#2069) |
| `POST /api/admin/shop/products/{id}/prices/accept` | Schritt 4: Selbstkosten als Mitgliederpreis übernehmen |
| `POST /api/admin/shop/products/{id}/sync` | Mit Printful abgleichen (Person im Protokoll) |
| `POST /api/admin/shop/products/{id}/status` | Schritt 5: `reviewed`, `active` (Grund Pflicht), `draft`, `archived` |

Offen für spätere Pakete: Mockups und ihre Prüfung (#1710), die Vereinsnummer-Datei (#1727), Fotos, Galerie und
Größentabelle. Löwe und Gamertag sind seit #2069 **eine** Datei je Fläche - der Testentwurf (#2062) schickt genau sie.

## Druckvorlagen und Druckdateien (#2069)

Code: `backend/services/shop_print_templates.py` (Vorlagen von Printful, Vorlagenbilder, Positions-Vorgaben),
`shop_print_files.py` (Motive, Generator, Ablage, Bestellung, Umstellung), `shop_catalog_search.py` (Produktsuche),
Routen `backend/routes/shop_print_template_routes.py` und `shop_product_routes.py`, Seite
`frontend/src/pages/admin/ShopLayoutStep.jsx` (Schritt 3) und `ShopProductSearch.jsx` (Schritt 1), Vorschau-Rechnung
`frontend/src/lib/shopLayout.js` (Spiegel der Server-Rechnung). Ziel: Druckdateien passen **zu 100 % zu Printful** - für
jedes Produkt, auch neue -, ohne eigenes Grafikprogramm.

**Eine Printful-Druckdatei ist immer die ganze Fläche einer Platzierung** in exakter Pixelgröße; das Motiv liegt darin,
der Rest ist transparent. Abgeglichen mit den offiziellen Vorlagen (Maße in `manifest.json`, „print_templates“):

| Produkt | Fläche | Druckdatei |
| --- | --- | --- |
| T-Shirt Gildan 5000 (DTG/DTF) | vorne bzw. hinten | 1800 × 2400 px bei 150 DPI = 30,48 × 40,64 cm |
| Gildan 5000 | Ärmel / Innenetikett | 600 × 525 bzw. 450 × 450 px bei 150 DPI |
| Trikot Allover | vorne bzw. hinten / Ärmel | 4950 × 6750 bzw. 4950 × 2250 px bei 150 DPI |
| Snapback (DTF) | vorne | 1350 × 705 px bei 300 DPI - die Produktseite nennt 13,97 × 6,35 cm, die API gilt |
| Tasse | 11 oz / 15 oz | 2250 × 925 bzw. 2253 × 1084 px bei 300 DPI (je Größe eine eigene Fläche) |
| Badetuch | 30×60 / 36×72 | 9300 × 4800 bzw. 11100 × 5700 px bei 150 DPI |

### Vorlagen von Printful

- **Maße:** `GET /v2/catalog-products/{id}/mockup-styles` - je Platzierung und Technik Druckbereich in Zoll und DPI;
  Druckdatei = `round(Zoll × DPI)` Pixel. Sind alle Ansichten einer Zeile auf Varianten beschränkt
  (`restricted_to_variants`), gilt die Fläche nur für diese - so bekommt die 15-oz-Tasse ihre eigene Datei (Gruppe).
- **Vorlagenbild:** `GET /v2/catalog-products/{id}/mockup-templates` - halbdurchsichtiges Bild mit Sicherheitslinien
  und die Lage des Druckbereichs darin (Pixel des Bilds), dazu `overlay` oder `background`.
- Gespeichert in `shop_print_templates` (eine Zeile je Printful-Produkt). Geholt in Schritt 1, bei „Mit Printful
  abgleichen“, im täglichen Abgleich und mit „Vorlagen neu laden“. Die Prüfsumme (`hash`) deckt nur die Maße ab. Ändert
  Printful eine Fläche, stehen die Sätze in `changes` und im Protokoll (`shop.print_template.change`), und alle Dateien
  dieser Fläche gelten als **veraltet**. Scheitert Printful, bleibt der letzte Stand (`last_error`).
- Ein Sicherheitsbereich als Zahl steht nicht in v2 (er ist ins Vorlagenbild gezeichnet) - dafür gibt es einen
  einstellbaren **Sicherheitsrand** je Art der Fläche (Vorgabe 0 cm).
- **Vorlagenbilder über die Website:** `GET /api/admin/shop/print-templates/{printful_product_id}/images/{index}` holt
  nur Adressen aus der gespeicherten Vorlage, nur von festen Printful-Hosts (`IMAGE_HOSTS`, https, Port 443, ohne
  Anmeldedaten), ohne Weiterleitung, höchstens 8 MB und 30 Millionen Pixel, neu kodiert als PNG ohne Metadaten,
  zwischengespeichert unter `UPLOAD_DIR/shop-templates/`. Eine Adresse aus der Anfrage gibt es nicht - keine offene
  Weiterleitung.

### Positions-Vorgaben (einstellbar)

Dokument `settings` mit `id = "shop_print_presets"` (Finanzen, Grund optional, Protokoll `shop.print.presets` mit
hinzugefügt/entfernt/geändert und den Regeln vorher/nachher). Jede Vorgabe ist **relativ zur Fläche**: waagrechte Mitte
als Anteil der Breite, Anker oben/mittig/unten, Abstand oben in cm, Standardbreite in cm - und gilt für Arten von
Flächen (Vorderseite, Rückseite, Ärmel, Etikett, Sonstige). Eine Vorgabe ist eine Empfehlung: sie bleibt in der Fläche
(und im Sicherheitsrand); danach kommt die Feinjustierung als Versatz in cm.

| Vorgabe | Fläche | Mitte / Anker / oben / Breite |
| --- | --- | --- |
| Brust rechts (vom Träger aus) - von vorne gesehen links, hier sitzt der Löwe | vorne | 27 % / oben / 5 cm / 8,9 cm |
| Brust links (vom Träger aus) | vorne | 73 % / oben / 5 cm / 8,9 cm |
| Vorne mittig, Vorne groß | vorne | 50 % / oben / 7,5 bzw. 2,5 cm / 20 bzw. 28 cm |
| Rücken groß, Rücken oben, Nacken | hinten | 50 % / oben / 5, 2,5, 0 cm / 28, 12, 7 cm |
| Ärmel, Etikett | Ärmel, Etikett | 50 % / mittig / 7,5 bzw. 6 cm |
| Kappe vorne | vorne | 50 % / mittig / 10 cm |
| Tasse umlaufend, Tasse einseitig, Tuch mittig | sonstige | 50 % bzw. 25 % / mittig / ganze Fläche, 8 cm, 40 cm |
| Brust gegenüber dem Motiv (Name) | vorne | gespiegelt zum ersten Motiv, senkrechte Mitte des Namens auf dessen Mitte |
| Unter dem Motiv, Rücken oben (Name), Mittig (Name) | alle bzw. hinten | unter dem ersten Motiv (1 cm Abstand), oben 3 cm, mittig |

**Regeln** im selben Dokument: Sicherheitsrand je Art der Fläche (cm), Auflösung eines Rastermotivs als Anteil der DPI
der Vorlage (darunter abgelehnt: Vorgabe 0,66 - also unter 100 DPI bei 150; darunter gewarnt: Vorgabe 1,0) und die
kleinste Breite eines Motivs (Vorgabe 1 cm). Routen: `GET`/`PUT /api/admin/shop/print-presets`.

### Aufbau je Produkt (Schritt 3)

`product.placements` je Printful-Fläche: `key` (= Printful-Platzierung), `technique`, `mode` (`layout` - Motiv und
Position; `upload` - fertige Datei für Profis) und `layers`:

- `motif`: Vorgabe, Breite in cm (der Regler endet an der Fläche), Versatz in cm, Motiv (`motif.key`) und - nur wenn
  nötig - eine **Ausnahme je Farbe** (`motif.by_color`: für diese Farbe ein anderes Motiv). Sonst gilt je Shirtfarbe
  automatisch die passende Fassung des Motivs (Abschnitt „Motive“: Hauptdatei für dunkle, Fassung für helle Shirts nach
  dem Farbwert von Printful; eine Ausnahme am Motiv geht vor).
- `gamertag`, `member_number`: Platzhalter mit Vorgabe (etwa „Brust gegenüber dem Motiv“); ihre Datei entsteht je
  Bestellung. Höchstens einer je Fläche, nur mit passender Personalisierung. Die Größe ist die Leinwand der
  Gamertag-Datei (`shop_gamertag.canvas`), ihr Anker (`anchor_y_in`) liegt auf der halben Höhe.

`PUT /api/admin/shop/products/{id}/layout` prüft für **jede angebotene Farbe und jede Größe mit eigener Fläche**, dass
alles ganz in der Fläche liegt - sonst 400 mit px, cm und Zoll. Protokoll `shop.product.layout` mit vorher/nachher.

**Umstellung alter Produkte** (feste Zoll-Positionen aus #1707): beim Lesen rechnet die Website sie um (nächste Vorgabe
nach der waagrechten Mitte, Breite in cm, der Rest als Versatz - die Lage bleibt). Gespeichert wird beim nächsten
Speichern in Schritt 3 oder mit dem Werkzeug:

```bash
docker compose exec backend python scripts/shop_print_layout.py                       # Trockenlauf: was würde
docker compose exec backend python scripts/shop_print_layout.py --anwenden            # speichern, alte Platzierungen in placements_legacy, Dateien erzeugen
docker compose exec backend python scripts/shop_print_layout.py --abbauen             # Rückweg ansehen
docker compose exec backend python scripts/shop_print_layout.py --abbauen --anwenden  # alte Platzierungen wieder einsetzen
```

Ein Produkt ohne gespeicherte Vorlage überspringt das Werkzeug (erst abgleichen). Der Stand eines Produkts bleibt.
Lässt sich auch nur **eine** alte Platzierung nicht abbilden, ist das ganze Produkt **nicht bestellbar** (fail-closed):
`place_order` sagt nur „Dieses Produkt ist gerade nicht bestellbar.“ (ebenso bei allem, was die Kundschaft nicht selbst lösen kann: Produkt nicht aktiv oder gesperrt, nicht lieferbar, kein Preis, unter dem Mindestpreis, fehlende Druckvorlage oder Druckdatei, unpassender Aufbau, fehlende Gamertag-Datei - der Grund steht mit Produkt und Variante als Warnung im Log und, wo er zum Aufbau gehört, in der Vorab-Prüfung; ein fehlender Gamertag oder ein Gamertag ohne Mitgliedschaft bleiben eigene Meldungen), die Vorab-Prüfung zeigt den Punkt „Druckflächen
umgestellt“ rot mit Fläche und Grund, bis Schritt 3 neu gespeichert ist.

### Generator und Ablage

`compose_print_file(width_px, height_px, dpi, layers)` ist rein (ohne Datenbank): genau ein PNG in der Pixelgröße der
Vorlage, transparent, sRGB-Pixel, im PNG **nur die DPI** als Metadatum, **deterministisch** (gleiche Eingaben = gleiche
Prüfsumme). Abgelehnt wird mit Zahlen in px, cm und Zoll: ein Motiv außerhalb der Fläche bzw. des Sicherheitsrands, ein
Rastermotiv mit zu wenig DPI bei der gewählten Größe (mit der nötigen Pixelbreite), mehr als 80 Millionen Pixel, eine
Grunddatei in anderer Größe. Unter der Warnschwelle gibt es einen Hinweis.

**Motive an einer Stelle:** `shop_print_files._motif_source` nimmt für die Shirtfarbe die Fassung über
`shop_motifs.file_for_garment` (hell oder dunkel samt Version; Seitenverhältnis aus der viewBox bzw. den Pixeln; bei SVG
keine DPI-Grenze), `_motif_png` rastert genau diese Fassung mit `shop_motifs.render_motif_png(…, version=…)` in der
Breite des Rahmens - SVG scharf, ein altes PNG wie bisher skaliert. Die Fassung samt Version steckt im `layout_hash`
(neue Version = neue Druckdatei), Schritt 3 zeigt in der Vorschau das Bild genau dieser Fassung, und die Bestellung
friert sie ein (`designs` mit `variant` und `version`). Tests ersetzen beide Funktionen durch einen Fake.

**„Druckdateien erzeugen“** (`POST /api/admin/shop/products/{id}/print-files`) erzeugt je Fläche, Farbe und Gruppe nur,
was fehlt oder veraltet ist (`layout_hash`: Maße der Vorlage, Rahmen, Motiv-Fassung, Generator-Version). Dieselben
Pixel ergeben keine neue Version. Eine Sperre je Produkt verhindert doppeltes Erzeugen. Protokoll `shop.print_file.add`.

**Ablage** `shop_print_files` wie die Designs: eigene Datei (`UPLOAD_DIR/shop-designs/`), SHA-256, Zufallsschlüssel mit
256 Bit, öffentlich unter `/api/shop/print-files/<schlüssel>/<name>.png` (Name der Grunddatei:
`<produkt>-<fläche>-<farbe>-v<version>.png`, einer Bestelldatei: `druck-<prüfsumme16>.png` - nie ein Name).
Grunddateien (`purpose = "base"`) zählen je Produkt, Fläche, Gruppe und Farbe hoch (eindeutiger Index).

**Für Profis:** `POST /api/admin/shop/print-files/upload` (Formular `file`, `product_id`, `placement`, `color`, optional
`group`) - wird **exakt** gegen die Vorlage geprüft: genau die Pixel der Vorlage, oder dasselbe Seitenverhältnis mit
mehr Pixeln (dann auf die exakte Größe verkleinert); kleiner oder anderes Seitenverhältnis wird mit px, cm und Zoll
abgelehnt. Neu kodiert wie ein Design (#1708). Höchstens 50 MB am Eingang (`body_limits`, nginx 51 MB).

**Vorschau:** `GET /api/admin/shop/products/{id}/preview?placement=&color=` - die Druckdatei über dem Vorlagenbild
(Sicherheitslinien) auf der Shirtfarbe von Printful, mit einem Beispielnamen im Platzhalter, als PNG (900 px breit).
Im Admin rechnet die Seite dieselbe Lage live (`shopLayout.js`), Feinjustieren per Ziehen oder Pfeiltasten (Umschalt:
1 cm). `GET /api/admin/shop/products/{id}/print-files/{file_id}` zeigt eine Grunddatei.

### Bestellung

`place_order` friert je Position **je Fläche genau eine Datei** ein (`print_files`): ohne Namen die geltende Grunddatei
(die zum Aufbau und zur Vorlage passen muss, sonst „nicht bestellbar“); mit Gamertag eine **eigene** Datei für genau
diese Position: Grunddatei plus Gamertag am Anker (`shop_gamertag.store` legt den Namen als Bestelldatei ab, Farbe nach
`inks_for_garment`). Die Motiv-Fassungen stehen weiter in `designs` (für die Aufbewahrung ihrer Adressen). Kommt die
Bestellung nicht zustande (gleichzeitiger Aufruf, spätere Position nicht bestellbar), sind die eigenen Dateien wieder
weg. Die Vereinsnummer bleibt Platzhalter bis #1727.

**Datenschutz:** Eine Bestelldatei mit Gamertag ist personenbezogen (das PNG zeigt den Namen) - `user_id`, Bestellung und
Position an der Zeile, nie der Name als Text. Auskunft unter `shop_print_files` (ohne Schlüssel und Ablageort),
Kontolöschung wie bei den Gamertag-Dateien (`shop_print_files.erase_for_user`, Abschluss im Job `ops_retention`).
Grunddateien gehören zum Katalog.

### Vorab-Prüfung

Neu: **Druckvorlage von Printful** (geladen, höchstens 14 Tage alt, letzte Änderung mit Sätzen) und **Druckdateien je
Farbe**: jede Fläche mit Motiv (bzw. fertiger Datei) hat für jede angebotene Farbe (und Gruppe) eine gültige Datei zum
aktuellen Aufbau und zur aktuellen Vorlage; fehlt sie oder ist sie veraltet, nennt die Prüfung Fläche und Farbe.

### Produktsuche (Schritt 1)

Die Nummer eines Katalogprodukts steht im Printful-Dashboard nirgends. `GET /api/admin/shop/printful-catalog` sucht im
Katalog: geladen über `GET /v2/catalog-products` (seitenweise je 100, Verkaufsregion Europa) und
`GET /v2/catalog-categories`, zwischengespeichert in `shop_printful_catalog` (ein Tag; Sperre gegen doppeltes Laden;
scheitert Printful, bleibt der letzte Stand). **Printful v2 hat keinen Textfilter** - gesucht wird lokal über Name,
Marke, Modell und Art (deutsche Wörter wie „Trikot“, „Tasse“, „Kappe“ finden die englischen Namen), mit Filter nach
Kategorie samt Unterkategorien. Ein eingefügter **Dashboard-Link** (`…/dashboard/custom/mens/shirts/unisex-classic-tee-gildan-5000?…`)
findet das Produkt über den Namen in Kleinbuchstaben mit Bindestrichen - die API liefert keinen Slug, darum zählt nur
ein eindeutiger Treffer. Die Nummer von Hand bleibt als Notfall. Ein Produkt je Modell: Farben und Größen kommen in
Schritt 2.

## Gamertag-Druckdatei (#1711)

Code: `backend/services/shop_gamertag.py`, Routen `backend/routes/shop_gamertag_routes.py`, Seite
`frontend/src/pages/admin/AdminShopGamertagPage.jsx` (Verwaltung → Finanzen → Shop → Reiter **Gamertag**). Teil 1:
Renderer, Regeln, Testdatei und Vorbelegung. Der Käufer-Ablauf folgt mit #1712/#1713, Mockups mit #1710, der
Testentwurf an Printful mit #2062.

**Schrift.** Fest eingebunden unter `backend/static/fonts` - dieselben Dateien wie die Website
(`frontend/public/fonts`, lateinischer Zeichensatz mit Umlauten und ß), alle unter der **SIL Open Font License 1.1**
(Lizenztexte `OFL-Rajdhani.txt`, `OFL-Outfit.txt`, `OFL-Unbounded.txt` daneben). Zur Wahl: Rajdhani Bold (Vorgabe,
schmal - passt zum Richtwert „7 Zeichen ≈ 2,4 Zoll“), Outfit Bold/ExtraBold, Unbounded ExtraBold. Die Rajdhani-Datei
hat gleich breite Ziffern (eigene Ableitung, `scripts/build_web_fonts.py`; die Lizenz erlaubt das).

**Renderer** (Pillow, ohne Netz und ohne Dateizugriff - die Schrift wird einmal in den Speicher gelesen):

- PNG mit Transparenz, Farbe überall und Deckkraft aus der Schrift (keine dunklen Ränder), im PNG nur die DPI.
- **Texthöhe** 0,5 Zoll (1,3 cm), gemessen an der Höhe der Großbuchstaben (umschaltbar auf „Schriftgröße“).
  **Höchstbreite** 3,5 Zoll (8,9 cm). Passt ein Name nicht, wird er bis **0,4 Zoll** (1 cm) verkleinert (Hinweis im
  Admin); passt er dann immer noch nicht, lehnt der Server mit Begründung in Zoll und cm ab.
- **300 DPI** wie die Löwen-Datei (einstellbar 300 bis 600).
- **Gleiche Leinwand für jeden Namen:** Höchstbreite × feste Höhe (aus Ober- und Unterlängen bei voller Texthöhe),
  der Name je nach Regel mittig, links oder rechts. Die **senkrechte Mitte der Großbuchstaben liegt genau auf der
  halben Höhe** - das ist der Anker (`anchor_y_in`), den die Produktverwaltung (#1707) auf die Mitte des Löwen legt.
  Damit braucht jede Variante nur eine Platzierung, egal wie lang der Name ist.
- **Deterministisch:** gleicher Text, gleiche Farbe und gleiche Regeln ergeben Byte für Byte dieselbe Datei und
  dieselbe Prüfsumme. `rules_hash` hält fest, was die Pixel bestimmt (Regeln, Prüfsumme der Schriftdatei,
  `RENDERER_VERSION`).

**Regeln** (Dokument `settings` mit `id = "shop_gamertag"`, nur Finanzen, mit Grund, Protokoll
`shop.gamertag.rules` mit vorher/nachher): Schrift, Bezug der Texthöhe, Texthöhe, Mindesthöhe, Höchstbreite (höchstens
so breit wie der Druckbereich der Platzierung „Brust links – Namensfeld“, #1708), DPI, Ausrichtung, Mindest- und
Höchstlänge (Vorgabe 2 bis 16), zusätzlich erlaubte Zeichen (Vorgabe Leerzeichen, `_ - .`, Umlaute und ß; Buchstaben
A–Z und Ziffern gehen immer; nur lateinische Zeichen, die die Schrift kennt), Wortfilter und **Farben**: je Farbe
Kennung, Bezeichnung, Farbwert und Shirtfarben. Mehrere Farben je Shirtfarbe sind erlaubt (etwa Weiß und Vereinsblau
auf Schwarz, die erste ist die Vorgabe, `inks_for_garment`); Vorgabefarbe Vereinsblau `#29B6E8` (Rolle `brand`).

**Prüfung des Namens:** Unicode zusammengesetzt (NFC; Vollbreite und Ähnliches werden nicht still umgedeutet), Rand
getrimmt, innen ein Leerzeichen; abgelehnt mit Begründung: leer, zu kurz, zu lang, **Emojis und Symbole**,
Steuerzeichen (Tabulator, unsichtbare Zeichen, Richtungswechsel), nicht erlaubte Zeichen (die Begründung nennt nur
diese Zeichen, nie den ganzen Namen). Danach der **Wortfilter der Moderation** (`services/word_filter.py`):
„zurückhalten“ lehnt immer ab, „markieren“ nach Vorgabe ebenfalls (ein Druck lässt sich nicht zurücknehmen; in den
Regeln abschaltbar, dann nur ein Hinweis). Der Admin-Test legt keinen Fund in der Moderation an.

**Kein Name im Log:** Der Gamertag steht nie im Log, nie im Protokoll der Adminaktionen und nie an der Datei-Zeile -
nur in der Datei selbst und (später) an der Bestellposition. Tests prüfen das mit einem Testnamen.

**Ablage** in `shop_gamertag_files` (Herkunft `origin = "gamertag"`; hochgeladene Designs tragen seit #1711
`origin = "upload"`): Datei im Speicher der Designs (`UPLOAD_DIR/shop-designs/<zufällig>.png`), SHA-256, eigener
Zufallsschlüssel (256 Bit), Maße, Anker, Farbe, `rules_hash`, `purpose` (`test` oder `order`), `last_used_at`.
Öffentlich wie die Designs: `GET /api/shop/print-files/<public_id>/gamertag-<prüfsumme16>.png` (Name ohne Gamertag).

- **Testdateien** (nur Finanzen, erfundene Namen) werden geteilt: je Prüfsumme eine Zeile (eindeutig `purpose` +
  `sha256` für `purpose = "test"`), sie behält ihre Adresse. Kennung der Finanzen an der Zeile, kein Konto -
  Vereinsinhalt mit der 30-Tage-Regel unten.
- **Bestelldateien** werden **nie geteilt**: jede Bestellung bekommt ihre eigene Datei mit eigener Adresse, auch bei
  gleichem Namen - nie die einer anderen Bestellung oder einer Testdatei, und aus einer Testdatei wird nie eine
  Bestelldatei. Sie sind **personenbezogen** (das PNG zeigt den Namen): `user_id` ist Pflicht, dazu `order_id` und
  `order_item_id` (#1712 trägt sie ein). Auskunft: Eintrag `shop_gamertag_files` (ohne Schlüssel und Ablageort).
  **Kontolöschung** (`erase_for_user`): die Verknüpfung zum Konto geht; braucht kein offener Printful-Auftrag die
  Datei, ist die Adresse sofort aus (`public_disabled_at`, 404) und die Datei gelöscht (`file_deleted_at`). Braucht ein
  offener Auftrag (Bestellung mit `printful_order_id`, Stand nicht abgeschlossen - die endgültigen Stände liefert
  #1716) sie noch, bleibt sie nur dafür abrufbar (`erase_pending_at`); der Job `ops_retention` schaltet sie nach dem
  Abschluss ab und löscht sie (`complete_pending_erasures`). Die Zeile bleibt ohne Konto mit Prüfsumme und Maßen.

**Einfrieren (für #1712/#1713):** `store(db, name, purpose="order", user_id=…, order_id=…, order_item_id=…,
color_key=…)` prüft, rendert und legt ab; `frozen_for_order(row, name)` liefert, was die Position einfriert: den
bestätigten Namen und Datei-Kennung, Prüfsumme, `rules_hash`, Maße, Anker, Farbe, Platzierung. Spätere Regeln erzeugen
neue Dateien; die eingefrorene bleibt liegen. `render` allein prüft den Wortfilter nicht und ist nicht für Aufrufe von
außen gedacht. Wer ein Gamertag-Feld sehen darf (nur Mitglieder, Produkte mit Gamertag), prüft die Bestellung selbst
(#1712).

**Größenlimit:** Vorschau und Testdatei nehmen höchstens 8 KB, Regeln 32 KB - geprüft am Eingang
(`services/body_limits.py`, `shop_gamertag.body_limits`), bevor Pydantic etwas liest; nginx begrenzt
`/api/admin/shop/gamertag/` auf 40 KB.

**Vorbelegung aus der Mitgliederakte:** `prefill_from_member_file(db, user)` liest den Gamertag aus dem
Website-Profil (Feld laut Zuordnung Dolibarr → Funktionen, `directory_field_map`) - nur mit bestätigter Zuordnung
bzw. Bindung. Antwortet Dolibarr nicht, kommt der zuletzt vom Abgleich übernommene Stand aus `club_member_profiles`
mit Datum (`source = "last_known"`, Hinweis für den Käufer). Ergebnis mit `valid`/`problem` nach den Regeln. Der
Shop **schreibt nie nach Dolibarr** zurück; eine Änderung gilt nur für die eine Bestellung.

**Aufbewahrung der Testdateien (nur Bericht):** `shop_gamertag.retention_plan(db)` nennt Testdateien, die 30 Tage
niemand benutzt hat - sie dürften weg. Gelöscht wird nichts; Fristen für Bestelldateien ohne Kontolöschung regelt #1731.

| Route (alle `require_area("finance")`) | Zweck |
| --- | --- |
| `GET /api/admin/shop/gamertag` | Regeln, Schriften mit Lizenz, Leinwand und Anker, letzte Testdateien |
| `POST /api/admin/shop/gamertag/preview` | Vorschau (`text`, `color`): geprüft und gerendert, nichts abgelegt |
| `POST /api/admin/shop/gamertag/test-files` | Testdatei mit Prüfsumme und Adresse (mit Grund, Protokoll `shop.gamertag.file`) |
| `PUT /api/admin/shop/gamertag/rules` | Regeln und Maße (mit Grund) |

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
| `catalog_products`, `catalog_categories` | `GET /v2/catalog-products` (seitenweise), `GET /v2/catalog-categories` (#2069, Produktsuche) | – | ja |
| `print_areas`, `mockup_templates` | `GET /v2/catalog-products/{id}/mockup-styles`, `…/mockup-templates` (#2069) | – | ja |
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
- **Rate-Limit:** Printful erlaubt 120 Aufrufe je Minute und Store. Der Adapter bleibt mit Luft darunter
  (`RATE_BUDGET_PER_MINUTE = 100` in jedem gleitenden 60-Sekunden-Fenster) und wartet sonst, statt in 429 zu laufen.
  Das Fenster gilt **prozessweit je Schlüssel** (alle Clients teilen es; jeder Aufruf reserviert seinen Platz, bevor er
  wartet). Das Backend läuft mit einem Uvicorn-Worker (`docker-entrypoint.py`, `--workers 1`); mehrere Abgleiche
  gleichzeitig verhindert zusätzlich eine MongoDB-Sperre (unten).
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

