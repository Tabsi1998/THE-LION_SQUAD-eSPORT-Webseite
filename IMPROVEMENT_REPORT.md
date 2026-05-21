# THE LION SQUAD eSPORT – Improvement Report
> Letzte Aktualisierung: Mai 2026

---

## Übersicht: 3 Ebenen

| Ebene | Technologie | Status |
|-------|-------------|--------|
| **Webseite** (Desktop) | React + Tailwind CSS | ✅ Vollständig |
| **Mobile Web** (responsive) | React + Tailwind CSS (responsive) | ✅ Vollständig |
| **App** (APK / Expo) | React Native + Expo | ✅ Vollständig |

---

## 🌐 Webseite & Mobile Web (Frontend)

### Fixes & Verbesserungen

#### BottomNav (Mobile Web – `BottomNav.jsx`) ✅
- **Bug fix**: Aktiv-Indikator war `absolute bottom-0` ohne `relative` auf Parent → jetzt `absolute top-0` mit korrektem `relative` auf Link-Element
- **Gäste-Navigation**: Neue Items für nicht-eingeloggte User: Home, Turniere, Events, **News**, **Season**
- **Auth-Navigation**: Home, Turniere, Events, Dashboard, Profil (sauber getrennt)
- `aria-current="page"` für Accessibility hinzugefügt
- `safe-area-inset-bottom` via inline-style statt CSS-Klasse (bessere Browser-Kompatibilität)

#### PublicLayout (`PublicLayout.jsx`) ✅
- **Bug fix**: ScrollTop-Button überlappt BottomNav auf Mobile → `bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+8px)] lg:bottom-5`
- **Footer-Padding**: `pb-16 lg:pb-0` am Footer damit Content nicht hinter BottomNav verschwindet

#### Tailwind Config (`tailwind.config.js`) ✅
- **Safe-area-inset Utilities** hinzugefügt:
  - `spacing.safe-top/bottom/left/right` → `env(safe-area-inset-*)`
  - `padding.safe-bottom` → für BottomNav-Abstand nutzbar
- Ermöglicht `pb-safe-bottom`, `pt-safe-top` etc. als Tailwind-Klassen

#### nginx.conf ✅
- **Gzip-Kompression** vollständig konfiguriert (30+ MIME-Types, Level 6, min. 256 Bytes)
- **Proxy-Keepalive** für `/api/` (`Connection: ""`, Timeouts 10s/60s)
- **Verbesserte Cache-Regeln**:
  - JS/CSS/Fonts: `1y immutable` + `Vary: Accept-Encoding`
  - Bilder: `30d` + `Vary: Accept-Encoding`
  - WebP/AVIF als eigene Location-Gruppe
- `gzip_vary on` für korrekte CDN-Kompatibilität

#### Navigation (bereits vorhanden, bestätigt ✅)
- Season Pass unter **eSports → Season Pass** in Desktop-Dropdown
- Alle Routen korrekt in `App.js` registriert
- `/seasons/current` Redirect vorhanden

#### SeasonPage (`SeasonPage.jsx`) – bereits vollständig ✅
- Rangliste mit Podium (🥇🥈🥉)
- Punkte-Erklärung (Turniere, Fast Lap, Events, Community)
- Mobile-Ansicht (`md:hidden` / `hidden md:block`)
- Structured Data / SEO

#### HomePage (`HomePage.jsx`) – bereits vollständig ✅
- Hero mit Framer Motion Animation
- Live-Banner wenn Stream aktiv
- SeasonPassWidget eingebunden
- Featured News + Timeline
- Structured Data (Schema.org)

---

## 📱 App (React Native / Expo → APK)

### Neu implementiert

#### app.json ✅
- **expo-updates** Plugin + Konfiguration hinzugefügt:
  - `checkAutomatically: "ON_LOAD"` – prüft bei jedem App-Start auf Updates
  - `fallbackToCacheTimeout: 3000` – 3s Timeout, dann gecachte Version
  - `runtimeVersion.policy: "appVersion"` – Updates nur bei gleicher App-Version
- **iOS bundleIdentifier** `at.lionsquad.app` hinzugefügt
- **Android Permissions** explizit deklariert (`INTERNET`, `ACCESS_NETWORK_STATE`)
- **NSAppTransportSecurity** für iOS konfiguriert

#### cache.ts (`src/lib/cache.ts`) 🆕
- **In-Memory Cache** (schnell, kein I/O) mit TTL-Ablauf (Standard: 10 Minuten)
- **SecureStore-Persistenz** für wichtige Endpunkte (Dashboard, News, Tournaments, Seasons, Profile)
- **Stale-Fallback**: `getStaleCache()` gibt Daten auch nach TTL-Ablauf zurück (für Offline-Modus)
- **Kein externes Package** – nur `expo-secure-store` (bereits installiert)
- Automatische Key-Sanitierung für SecureStore (max. 255 Zeichen, nur erlaubte Zeichen)
- Payload-Limit-Check (< 2KB für SecureStore)
- `invalidateCache(pattern?)` und `clearAllCache()` für gezielte Cache-Invalidierung

#### api.ts (`src/lib/api.ts`) ✅ (erweitert)
- **15s Timeout** hinzugefügt (verhindert endloses Warten bei schlechtem Netz)
- **Offline-Fallback**: Bei Netzwerkfehler/Timeout → `getStaleCache()` → gecachte Daten zurückgeben
- **Automatisches Caching**: Erfolgreiche GET-Responses werden automatisch gecacht
- **Benutzerfreundliche Fehlermeldungen**:
  - Timeout → "Verbindung zu langsam. Bitte versuche es erneut."
  - Kein Netz → "Keine Internetverbindung. Bitte prüfe dein Netz."
- **`isOfflineError()`** Hilfsfunktion für Screens (zeigt Offline-Banner)
- Token-Refresh: `try/catch` um `clearSession()` ergänzt (verhindert unbehandelte Rejection)

#### Season-Pass Screen (`SeasonPassScreen.tsx`) 🆕
- Vollständiger Jahres-Punktesystem-Screen
- Rangliste mit Podium (🥇🥈🥉 Gold/Silber/Bronze)
- Eigener Rang hervorgehoben
- Punkte-Erklärung: Turnier gewinnen +50, Event besuchen +15, Fast Lap Bestzeit +20, etc.
- Pull-to-Refresh, Fallback für leere Season
- Preis-Banner mit Trophäe

#### MoreScreen (`MoreScreen.tsx`) – komplett überarbeitet 🔄
- Season-Pass als erstes/prominentes Element (Gold-Badge "🏆 Neu")
- Icons für jeden Eintrag (Ionicons)
- **Discord-Link** (extern öffnen via `Linking.openURL`)
- **App-Version** unten via `expo-constants`
- Kategorie-Trenner "COMMUNITY"

#### NewsScreen (`NewsScreen.tsx`) – Kategorie-Filter + Suche 🔄
- **Suchfeld** mit Live-Filterung (Titel, Excerpt, Kategorie)
- **Horizontale Kategorie-Chips** (dynamisch aus API-Daten extrahiert)
- **Ergebnis-Zähler** bei aktiver Suche/Filter
- Kategorie-Badge auf jeder News-Karte

#### DashboardScreen (`DashboardScreen.tsx`) – Season-Pass Quick-Link 🔄
- Neue **Season-Pass Karte** mit Gold-Styling direkt im Dashboard
- Direktlink zur Rangliste

#### Navigation (`types.ts` + `AppNavigator.tsx`) 🔄
- `SeasonPass: undefined` Route in `MoreStackParamList` hinzugefügt
- Route in `MoreStackScreen` registriert

### Bereits vorhanden (bestätigt ✅)

#### JWT-Refresh-Token Interceptor (`api.ts`)
- Automatischer Retry bei 401
- Deduplication via `refreshPromise`

#### Echtzeit-Notifications (`NotificationContext.tsx`)
- 15s Polling + In-App Popups mit Auto-Dismiss

#### TournamentsScreen (`TournamentsScreen.tsx`)
- Filter-Chips: Alle / Events / Turniere / Fast Laps

---

## 🐛 Bugs (behoben)

| Bug | Datei | Fix |
|-----|-------|-----|
| ScrollTop-Button überlappt BottomNav | `PublicLayout.jsx` | `bottom-[calc(4rem+...)]` |
| BottomNav Aktiv-Indikator falsch positioniert | `BottomNav.jsx` | `absolute top-0` + `relative` auf Link |
| Footer-Content hinter BottomNav | `PublicLayout.jsx` | `pb-16 lg:pb-0` |
| Season-Pass Route fehlte in App | `types.ts` + `AppNavigator.tsx` | Route hinzugefügt |
| MoreScreen ohne Discord/App-Info | `MoreScreen.tsx` | Komplett überarbeitet |
| App kein Timeout bei schlechtem Netz | `api.ts` | `timeout: 15000` |
| App kein Offline-Fallback | `api.ts` + `cache.ts` | Stale-Cache-Fallback |
| Gzip fehlte in nginx | `nginx.conf` | Vollständige Gzip-Konfiguration |
| safe-area-inset fehlte in Tailwind | `tailwind.config.js` | Spacing-Utilities hinzugefügt |
| expo-updates fehlte | `app.json` | Plugin + Konfiguration hinzugefügt |

---

## 📋 Offene Punkte / Empfehlungen

### Web
- [ ] PWA-Manifest (`manifest.json`) prüfen – `theme_color`, `background_color`, `display: standalone`
- [ ] Service Worker für Web-Offline-Caching (Workbox via CRA)
- [ ] Lighthouse-Audit für Performance (LCP, CLS)

### App
- [x] Push-Notifications via Expo Notifications API ✅
  - `expo-notifications` + `expo-device` in `package.json` hinzugefügt
  - `PushService.ts` erstellt (graceful degradation wenn Package fehlt)
  - Push-Token wird beim Login automatisch registriert
  - Android Notification Channels konfiguriert (default + tournaments)
  - App-Badge-Zähler wird automatisch aktualisiert
  - **Backend noch nötig**: `/mobile/push-token` POST/DELETE Endpoint
- [ ] `expo-updates` EAS-Projekt-ID in `app.json` korrekt setzen (aktuell Platzhalter "lionsapp")
  - Echte Project-ID von https://expo.dev holen
- [ ] App-Icon und Splash-Screen Assets prüfen (1024x1024 PNG für App Store)

### Backend
- [ ] `/seasons/current` Endpoint – gibt er immer eine aktive Season zurück?
- [ ] Rate-Limiting für Notification-Polling prüfen (15s × viele User = Last)
- [ ] API-Response-Größen optimieren (Pagination wo nötig, damit SecureStore-Cache greift)

---

*Generiert von Claude AI – THE LION SQUAD eSPORT Webseite Improvement Session*
