import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { installMobileLogHandlers } from "./src/lib/mobileLog";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { NotificationProvider } from "./src/notifications/NotificationContext";
import { LiveChangesProvider } from "./src/realtime/LiveChangesProvider";

installMobileLogHandlers();

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider navigationBarTranslucent statusBarTranslucent>
        <AppErrorBoundary>
          <AuthProvider>
            <LiveChangesProvider>
              <NotificationProvider>
                <StatusBar style="light" />
                <AppNavigator />
              </NotificationProvider>
            </LiveChangesProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
