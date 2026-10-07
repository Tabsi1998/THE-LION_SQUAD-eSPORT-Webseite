import type React from "react";
import { AchievementShowcaseScreen } from "../screens/main/AchievementShowcaseScreen";
import { AdmissionScreen } from "../screens/main/AdmissionScreen";
import { AdventCalendarScreen } from "../screens/main/AdventCalendarScreen";
import { ClubAboutScreen } from "../screens/main/ClubAboutScreen";
import { CommunityScreen } from "../screens/main/CommunityScreen";
import { DashboardScreen } from "../screens/main/DashboardScreen";
import { DirectThreadScreen } from "../screens/main/DirectThreadScreen";
import { EasterHuntScreen } from "../screens/main/EasterHuntScreen";
import { EventDetailScreen } from "../screens/main/EventDetailScreen";
import { FastLapDetailScreen } from "../screens/main/FastLapDetailScreen";
import { GalleryAlbumScreen } from "../screens/main/GalleryAlbumScreen";
import { GalleryScreen } from "../screens/main/GalleryScreen";
import { GalleryViewerScreen } from "../screens/main/GalleryViewerScreen";
import { InfoCenterScreen } from "../screens/main/InfoCenterScreen";
import { MatchDetailScreen } from "../screens/main/MatchDetailScreen";
import { MemberCardScreen } from "../screens/main/MemberCardScreen";
import { MemberDocumentsScreen } from "../screens/main/MemberDocumentsScreen";
import { MemberHelperShiftsScreen } from "../screens/main/MemberHelperShiftsScreen";
import { MemberMeetingsScreen } from "../screens/main/MemberMeetingsScreen";
import { MyInvoicesScreen } from "../screens/main/MyInvoicesScreen";
import { MyMembershipScreen } from "../screens/main/MyMembershipScreen";
import { MyPrizesScreen } from "../screens/main/MyPrizesScreen";
import { NewsDetailScreen } from "../screens/main/NewsDetailScreen";
import { NewsScreen } from "../screens/main/NewsScreen";
import { NotificationsScreen } from "../screens/main/NotificationsScreen";
import { ProfileEditScreen } from "../screens/main/ProfileEditScreen";
import { ProfileScreen } from "../screens/main/ProfileScreen";
import { PublicProfileScreen } from "../screens/main/PublicProfileScreen";
import { SearchScreen } from "../screens/main/SearchScreen";
import { SeasonPassScreen } from "../screens/main/SeasonPassScreen";
import { SettingsScreen } from "../screens/main/SettingsScreen";
import { TeamChatScreen } from "../screens/main/TeamChatScreen";
import { TeamDetailScreen } from "../screens/main/TeamDetailScreen";
import { TournamentChatScreen } from "../screens/main/TournamentChatScreen";
import { TournamentDetailScreen } from "../screens/main/TournamentDetailScreen";
import { TournamentsScreen } from "../screens/main/TournamentsScreen";
import { VereinScreen } from "../screens/main/VereinScreen";
import type { DetailScreenName, TabRootParamList } from "./types";

// Welche Datei hinter welchem Screen steht (#1143, #1144) - an einer Stelle, damit der Navigator und die Tests dieselbe
// Liste sehen. Die Übersicht jedes Tabs und die Detail-Screens, die in jedem Tab-Stapel liegen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = React.ComponentType<any>;

export const TAB_ROOT_SCREENS: Record<keyof TabRootParamList, Screen> = {
  Dashboard: DashboardScreen,
  TournamentList: TournamentsScreen,
  CommunityHub: CommunityScreen,
  VereinHub: VereinScreen,
  Profile: ProfileScreen,
};

export const DETAIL_SCREENS: Record<DetailScreenName, Screen> = {
  TournamentDetail: TournamentDetailScreen,
  EventDetail: EventDetailScreen,
  FastLapDetail: FastLapDetailScreen,
  MatchDetail: MatchDetailScreen,
  TournamentChat: TournamentChatScreen,
  TeamDetail: TeamDetailScreen,
  TeamChat: TeamChatScreen,
  PublicProfile: PublicProfileScreen,
  DirectThread: DirectThreadScreen,
  NewsList: NewsScreen,
  NewsDetail: NewsDetailScreen,
  Gallery: GalleryScreen,
  GalleryAlbum: GalleryAlbumScreen,
  GalleryViewer: GalleryViewerScreen,
  Notifications: NotificationsScreen,
  Search: SearchScreen,
  SeasonPass: SeasonPassScreen,
  AchievementShowcase: AchievementShowcaseScreen,
  AdventCalendar: AdventCalendarScreen,
  EasterHunt: EasterHuntScreen,
  MyInvoices: MyInvoicesScreen,
  MyPrizes: MyPrizesScreen,
  MyMembership: MyMembershipScreen,
  MemberDocuments: MemberDocumentsScreen,
  MemberMeetings: MemberMeetingsScreen,
  MemberHelperShifts: MemberHelperShiftsScreen,
  MemberCard: MemberCardScreen,
  Admission: AdmissionScreen,
  InfoCenter: InfoCenterScreen,
  ClubAbout: ClubAboutScreen,
  Settings: SettingsScreen,
  ProfileEdit: ProfileEditScreen,
};
