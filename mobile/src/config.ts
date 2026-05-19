const defaultApiBaseUrl = __DEV__ ? "http://10.0.2.2:8000" : "https://lionsquad.at";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl
).replace(/\/+$/, "");

export const API_URL = `${API_BASE_URL}/api`;
