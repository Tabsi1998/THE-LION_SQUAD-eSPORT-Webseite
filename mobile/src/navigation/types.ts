export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Tournaments: undefined;
  Teams: undefined;
  Profile: undefined;
  More: undefined;
};

export type TournamentStackParamList = {
  TournamentList: undefined;
  TournamentDetail: { id: string };
};

export type TeamStackParamList = {
  TeamList: undefined;
  TeamDetail: { id: string };
};

export type MoreStackParamList = {
  MoreHub: undefined;
  InfoCenter: { section?: "sponsors" | "partners" | "events" | "benefits" | "references" | "profiles" } | undefined;
};
