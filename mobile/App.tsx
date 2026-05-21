import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { NotificationProvider } from "./src/notifications/NotificationContext";

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider navigationBarTranslucent statusBarTranslucent>
        <AppErrorBoundary>
          <AuthProvider>
            <NotificationProvider>
              <StatusBar style="light" />
              <AppNavigator />
            </NotificationProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
