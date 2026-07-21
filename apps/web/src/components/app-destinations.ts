import {
  BookmarkIcon,
  BookUserIcon,
  BoxIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  HomeIcon,
} from "lucide-react";

export const appDestinations = [
  { href: "/", label: "Dashboard", icon: HomeIcon },
  { href: "/people", label: "People", icon: BookUserIcon },
  { href: "/actions", label: "Actions", icon: CircleDotIcon },
  { href: "/assets", label: "Assets", icon: BoxIcon },
  { href: "/saved-items", label: "Saved Items", icon: BookmarkIcon },
  { href: "/account", label: "Account", icon: CircleUserRoundIcon },
];
