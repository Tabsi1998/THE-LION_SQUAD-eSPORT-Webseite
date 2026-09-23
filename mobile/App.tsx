import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { BrandingProvider } from "./src/branding/BrandingProvider";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { installMobileLogHandlers } from "./src/lib/mobileLog";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { NotificationProvider } from "./src/notifications/NotificationContext";
import { LiveChangesProvider } from "./src/realtime/LiveChangesProvider";
import { AppUpdateProvider } from "./src/update/AppUpdateProvider";

installMobileLogHandlers();

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider navigationBarTranslucent statusBarTranslucent>
        <AppErrorBoundary>
          <AuthProvider>
            <LiveChangesProvider>
              <BrandingProvider>
                <NotificationProvider>
                  <AppUpdateProvider>
                    <StatusBar style="light" />
                    <AppNavigator />
                  </AppUpdateProvider>
                </NotificationProvider>
              </BrandingProvider>
            </LiveChangesProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
