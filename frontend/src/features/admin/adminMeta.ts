import DashboardIcon from "@mui/icons-material/Dashboard";
import PeopleIcon from "@mui/icons-material/People";
import NotificationsIcon from "@mui/icons-material/Notifications";
import TagIcon from "@mui/icons-material/Tag";
import WorkIcon from "@mui/icons-material/Work";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import HistoryIcon from "@mui/icons-material/History";
import ContactMailIcon from "@mui/icons-material/ContactMail";
import StorageIcon from "@mui/icons-material/Storage";
import ForumIcon from "@mui/icons-material/Forum";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import LinkIcon from "@mui/icons-material/Link";
import { api } from "@/app/api";

export type Section = "dashboard" | "users" | "notifications" | "contacts" | "channels" | "applications" | "resources" | "game-downloads" | "messaging-history" | "activity-logs" | "database" | "about-our-story" | "link-file-management";

export type DashboardStats = Awaited<ReturnType<typeof api.admin.stats>>;

export const EMPTY_STATS: DashboardStats = {
  totalUsers: 0,
  onlineUsers: 0,
  pendingApplications: 0,
  pendingJobApplications: 0,
  pendingDmRequests: 0,
  unreadContacts: 0,
  notifications: 0,
  totalDownloads: 0,
  totalMessages: 0,
  userDistribution: [],
  userGrowth: [],
  activityTimeline: [],
  downloadsByPlatform: [],
  mostDownloadedResource: null,
  recentUsers: [],
  recentApplications: [],
  recentContacts: [],
  recentActivity: [],
};

export const CHART_COLORS = ["#6750A4", "#386A20", "#B3261E", "#006A6A", "#7D5260", "#625B71"];

/** Standard admin nav — Super Admin–only items are listed separately at the bottom. */
export const STANDARD_SECTIONS: { id: Section; label: string; Icon: typeof DashboardIcon }[] = [
  { id: "dashboard", label: "Dashboard", Icon: DashboardIcon },
  { id: "users", label: "Users", Icon: PeopleIcon },
  { id: "contacts", label: "Contact Management", Icon: ContactMailIcon },
  { id: "notifications", label: "Notifications", Icon: NotificationsIcon },
  { id: "channels", label: "Channels", Icon: TagIcon },
  { id: "about-our-story", label: "Our Story", Icon: AutoStoriesIcon },
  { id: "applications", label: "Teamwork Applications", Icon: WorkIcon },
  { id: "resources", label: "Resources", Icon: MenuBookIcon },
  { id: "game-downloads", label: "Game Downloads", Icon: SportsEsportsIcon },
  { id: "activity-logs", label: "Activity Logs", Icon: HistoryIcon },
];

/** Super Admin–only tools — rendered after a sidebar separator. */
export const SUPER_ADMIN_SECTIONS: { id: Section; label: string; Icon: typeof DashboardIcon }[] = [
  { id: "database", label: "Database", Icon: StorageIcon },
  { id: "messaging-history", label: "Messaging History", Icon: ForumIcon },
  { id: "link-file-management", label: "Link File Management", Icon: LinkIcon },
];

export const SECTIONS: { id: Section; label: string; Icon: typeof DashboardIcon }[] = [
  ...STANDARD_SECTIONS,
  ...SUPER_ADMIN_SECTIONS,
];

