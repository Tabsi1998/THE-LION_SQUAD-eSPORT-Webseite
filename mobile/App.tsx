import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { NotificationProvider } from "./src/notifications/NotificationContext";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <AuthProvider>
          <NotificationProvider>
            <StatusBar style="light" />
            <AppNavigator />
          </NotificationProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
