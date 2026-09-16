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
    expoConfig: { version: "0.4.1-beta", extra: { clientLogging: false, eas: { projectId: "test-project" } } },
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

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

beforeEach(() => {
  // Vor jedem Test neu setzen: sonst kann eine andere Einrichtung die Kennung
  // zurueckdrehen und React verweigert Zustandsaenderungen ausserhalb von act().
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockSecureStore.clear();
});
