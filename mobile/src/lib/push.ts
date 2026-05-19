import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerDevicePushToken() {
  try {
    if (Platform.OS === "web") return;
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
    // Push is a progressive enhancement; in-app notifications still work.
  }
}
