import { Platform } from "react-native";
import { api } from "./api";

export async function registerDevicePushToken() {
  try {
    if (Platform.OS === "web") return;
    const Notifications = await import("expo-notifications");

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "LionsAPP",
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#29B6E8",
      });
    }

    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;

    const result = await Notifications.getExpoPushTokenAsync();
    await api.post("/mobile/push-token", {
      token: result.data,
      platform: Platform.OS,
      device_name: Platform.OS,
    });
  } catch {
    // Push is optional. The in-app notification inbox remains available.
  }
}
