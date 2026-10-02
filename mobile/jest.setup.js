/* eslint-env jest */

// React 19 aktualisiert den Zustand ausserhalb von act() nur, wenn die
// Testumgebung sich als solche zu erkennen gibt.
global.IS_REACT_ACT_ENVIRONMENT = true;

// Native Module, die im Test keinen echten Gegenpart haben. Der sichere Speicher
// wird bewusst als einfache Map nachgebildet, damit Tests pruefen koennen, was
// tatsaechlich abgelegt und beim Abmelden geloescht wird.
// Der Name muss mit "mock" beginnen, sonst verbietet Jest den Zugriff aus der
// hochgezogenen Mock-Fabrik.
const mockSecureStore = new Map();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key) => (mockSecureStore.has(key) ? mockSecureStore.get(key) : null)),
  setItemAsync: jest.fn(async (key, value) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { version: "0.5.0-beta", android: { versionCode: 63 }, extra: { clientLogging: false, eas: { projectId: "test-project" } } },
  },
}));

jest.mock("expo-device", () => ({ isDevice: false }));

// Galerie, Videowiedergabe und Standbild haben im Test kein Gerät. Die Tests
// setzen die Rückgabe von launchImageLibraryAsync selbst.
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: jest.fn(async () => ({ uri: "file:///vorschau.jpg", width: 320, height: 180 })),
}));
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn(() => ({ play: jest.fn() })),
  VideoView: () => null,
}));

// Gerätekalender und System-Teilen (#216, #236) haben im Test kein Gerät: Berechtigung
// verweigert, Teilen verfügbar aber ohne Wirkung - die Tests setzen Abweichungen selbst.
jest.mock("expo-calendar", () => ({
  requestCalendarPermissionsAsync: jest.fn(async () => ({ status: "denied", granted: false })),
  getCalendarsAsync: jest.fn(async () => []),
  getDefaultCalendarAsync: jest.fn(async () => null),
  createEventAsync: jest.fn(async () => "event-1"),
  EntityTypes: { EVENT: "event" },
}));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

// App-Sperre (#217): im Test ein Gerät mit Fingerabdruck, das jede Abfrage bestätigt -
// abgebrochene Versuche und Geräte ohne Sperre stellen die Tests selbst ein.
jest.mock("expo-local-authentication", () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

// Absturzberichte (#219): im Test kein Firebase - die Aufrufe werden nur gezählt.
jest.mock("@react-native-firebase/crashlytics", () => ({
  getCrashlytics: jest.fn(() => ({ app: "test" })),
  setCrashlyticsCollectionEnabled: jest.fn(async () => null),
  recordError: jest.fn(),
  log: jest.fn(),
}));

// Passkeys (#217 Stufe 2): im Test ein Gerät, das Passkeys kann und jede Anfrage unterschreibt.
jest.mock("react-native-passkey", () => ({
  Passkey: {
    isSupported: jest.fn(() => true),
    get: jest.fn(async () => ({ id: "cred-1", rawId: "cred-1", type: "public-key", response: { clientDataJSON: "c", authenticatorData: "a", signature: "s", userHandle: "u" } })),
    create: jest.fn(async () => ({ id: "cred-1", rawId: "cred-1", type: "public-key", response: { clientDataJSON: "c", attestationObject: "o" } })),
  },
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// Reanimated 4 (Schnee und Wetter in der App, #642/#771): im Test gibt es keinen UI-Thread und keine
// Worklet-Laufzeit - die mitgelieferte Attrappe lädt sie trotzdem und kennt useFrameCallback nicht. Diese kleine
// Nachbildung deckt ab, was die Saison-Ebenen nutzen; `__frameCallbacks` lässt Tests Bilder von Hand weiterschalten.
jest.mock("react-native-reanimated", () => {
  const React = require("react");
  const { View } = require("react-native");
  const frameCallbacks = new Set();
  const mutable = (initial) => {
    const holder = {
      value: initial,
      get: () => holder.value,
      set: (next) => {
        holder.value = typeof next === "function" ? next(holder.value) : next;
      },
      modify: (modifier) => {
        holder.value = modifier ? modifier(holder.value) : holder.value;
      },
    };
    return holder;
  };
  const Animated = { View, createAnimatedComponent: (component) => component };
  return {
    __esModule: true,
    default: Animated,
    View,
    makeMutable: mutable,
    useSharedValue: (initial) => {
      const ref = React.useRef(null);
      if (!ref.current) ref.current = mutable(initial);
      return ref.current;
    },
    useAnimatedStyle: (updater) => updater(),
    useFrameCallback: (callback, autostart = true) => {
      const ref = React.useRef(null);
      if (!ref.current) {
        ref.current = { isActive: autostart, callbackId: 1, setActive: (active) => { ref.current.isActive = Boolean(active); } };
      }
      React.useEffect(() => {
        const entry = { callback, handle: ref.current };
        frameCallbacks.add(entry);
        return () => {
          frameCallbacks.delete(entry);
        };
      }, [callback]);
      return ref.current;
    },
    runOnJS: (fn) => fn,
    withTiming: (toValue) => toValue,
    withSequence: (...steps) => steps[steps.length - 1],
    withDelay: (_ms, value) => value,
    withRepeat: (value) => value,
    cancelAnimation: () => {},
    Easing: { linear: (t) => t, quad: (t) => t * t, inOut: (fn) => fn, out: (fn) => fn, in: (fn) => fn },
    __frameCallbacks: frameCallbacks,
  };
});

// Skia (Silvester, #642): im Test gibt es keine Zeichenfläche. Die Attrappe nimmt Zeichenbefehle entgegen und zählt
// sie (`__skiaDraws`), damit Tests sehen, dass gezeichnet wird.
jest.mock("@shopify/react-native-skia", () => {
  const React = require("react");
  const { View } = require("react-native");
  const draws = { circles: 0 };
  const canvas = { drawCircle: () => { draws.circles += 1; } };
  const paint = () => ({ setColor() {}, setAlphaf() {}, setBlendMode() {}, setAntiAlias() {} });
  return {
    __esModule: true,
    Canvas: ({ children, ...props }) => React.createElement(View, props, children),
    Picture: () => null,
    BlendMode: { Plus: 12 },
    createPicture: () => ({ kind: "picture" }),
    Skia: {
      PictureRecorder: () => ({ beginRecording: () => canvas, finishRecordingAsPicture: () => ({ kind: "picture" }) }),
      Paint: paint,
      Color: (value) => value,
      XYWHRect: (x, y, width, height) => ({ x, y, width, height }),
    },
    __skiaDraws: draws,
  };
});

beforeEach(() => {
  // Vor jedem Test neu setzen: sonst kann eine andere Einrichtung die Kennung
  // zurueckdrehen und React verweigert Zustandsaenderungen ausserhalb von act().
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockSecureStore.clear();
});
