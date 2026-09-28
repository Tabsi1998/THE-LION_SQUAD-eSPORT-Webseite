import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { BrandingProvider } from "./src/branding/BrandingProvider";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { installCrashReporting } from "./src/lib/crashReports";
import { installMobileLogHandlers } from "./src/lib/mobileLog";
import { AppLockProvider } from "./src/lock/AppLockProvider";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { NotificationProvider } from "./src/notifications/NotificationContext";
import { LiveChangesProvider } from "./src/realtime/LiveChangesProvider";
import { SeasonProvider } from "./src/seasons/SeasonProvider";
import { AppUpdateProvider } from "./src/update/AppUpdateProvider";

installMobileLogHandlers();
void installCrashReporting();

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider navigationBarTranslucent statusBarTranslucent>
        <AppErrorBoundary>
          <AuthProvider>
            <LiveChangesProvider>
              <BrandingProvider>
                <SeasonProvider>
                <AppLockProvider>
                  <NotificationProvider>
                    <AppUpdateProvider>
                      <StatusBar style="light" />
                      <AppNavigator />
                    </AppUpdateProvider>
                  </NotificationProvider>
                </AppLockProvider>
                </SeasonProvider>
              </BrandingProvider>
            </LiveChangesProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
