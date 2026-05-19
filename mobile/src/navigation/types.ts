import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Tournaments: NavigatorScreenParams<TournamentStackParamList> | undefined;
  Teams: NavigatorScreenParams<TeamStackParamList> | undefined;
  Profile: undefined;
  More: NavigatorScreenParams<MoreStackParamList> | undefined;
};

export type TournamentStackParamList = {
  TournamentList: undefined;
  TournamentDetail: { id: string };
  EventDetail: { id: string };
  FastLapDetail: { id: string };
  TournamentChat: { id: string; title?: string };
};

export type TeamStackParamList = {
  TeamList: undefined;
  TeamDetail: { id: string };
  TeamChat: { id: string; title?: string };
};

export type MoreStackParamList = {
  MoreHub: undefined;
  InfoCenter: { section?: "sponsors" | "partners" | "events" | "benefits" | "references" | "profiles" } | undefined;
  NewsList: undefined;
  NewsDetail: { id: string };
  FastLapList: undefined;
  FastLapDetail: { id: string };
  DirectMessages: undefined;
  DirectThread: { userId: string; title?: string };
  Notifications: undefined;
};
