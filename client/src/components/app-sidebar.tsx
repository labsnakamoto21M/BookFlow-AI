import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Settings,
  LayoutDashboard,
  ShieldBan,
  Briefcase,
  Clock,
  LogOut,
  CreditCard,
  Zap,
  AlertTriangle,
  Ghost,
  Moon,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LightningLogo } from "@/components/lightning-logo";
import { queryClient, apiRequest } from "@/lib/queryClient";

const getMainMenuItems = (t: (key: string) => string) => [
  {
    title: t("sidebar.dashboard"),
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: t("sidebar.agenda"),
    url: "/agenda",
    icon: Calendar,
  },
  {
    title: t("sidebar.services"),
    url: "/services",
    icon: Briefcase,
  },
  {
    title: t("sidebar.schedule"),
    url: "/horaires",
    icon: Clock,
  },
];

const getWhatsappMenuItems = (t: (key: string) => string) => [
  {
    title: t("sidebar.whatsappConnection"),
    url: "/whatsapp",
    icon: SiWhatsapp,
  },
];

const getAdminMenuItems = (t: (key: string) => string) => [
  {
    title: t("sidebar.reports"),
    url: "/signalements",
    icon: AlertTriangle,
  },
  {
    title: t("sidebar.blacklist"),
    url: "/blacklist",
    icon: ShieldBan,
  },
  {
    title: t("sidebar.subscription"),
    url: "/abonnement",
    icon: CreditCard,
  },
];

const modeConfig = {
  active: { label: "ACTIVE", icon: Zap, color: "text-green-500 neon-text" },
  away: { label: "AWAY", icon: Moon, color: "text-yellow-500" },
  ghost: { label: "GHOST", icon: Ghost, color: "text-gray-500" },
};

const LANGUAGES = [
  { code: "fr", label: "FR" },
  { code: "nl", label: "NL" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "ro", label: "RO" },
  { code: "pt", label: "PT" },
  { code: "de", label: "DE" },
  { code: "sq", label: "SQ" },
  { code: "hu", label: "HU" },
  { code: "it", label: "IT" },
  { code: "zh", label: "ZH" },
] as const;

function LanguageSelector() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.substring(0, 2) || "fr";

  const changeLanguage = (langCode: string) => {
    i18n.changeLanguage(langCode);
    localStorage.setItem("chatslot-language", langCode);
  };

  return (
    <div className="flex flex-wrap gap-1 justify-center px-2">
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => changeLanguage(code)}
          className={`font-mono text-xs px-1.5 py-0.5 rounded-sm transition-all ${
            currentLang === code
              ? "bg-primary/20 text-primary neon-text border border-primary/50"
              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          data-testid={`button-lang-${code}`}
        >
          [{label}]
        </button>
      ))}
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t } = useTranslation();

  const { data: modeData } = useQuery<{ mode: string }>({
    queryKey: ["/api/provider/availability-mode"],
  });

  const modeMutation = useMutation({
    mutationFn: (mode: string) => apiRequest("PATCH", "/api/provider/availability-mode", { mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/availability-mode"] });
    },
  });

  const currentMode = modeData?.mode || "active";
  const modes = ["active", "away", "ghost"] as const;

  const cycleMode = () => {
    const currentIndex = modes.indexOf(currentMode as typeof modes[number]);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    modeMutation.mutate(nextMode);
  };

  const initials = user
    ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "U"
    : "U";

  const ModeIcon = modeConfig[currentMode as keyof typeof modeConfig]?.icon || Zap;
  const modeLabel = modeConfig[currentMode as keyof typeof modeConfig]?.label || "ACTIVE";
  const modeColor = modeConfig[currentMode as keyof typeof modeConfig]?.color || "text-green-500";

  return (
    <Sidebar className="border-r border-primary/30">
      <SidebarHeader className="p-4 border-b border-primary/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LightningLogo size="md" />
            <div className="flex flex-col">
              <span className="font-mono font-semibold text-lg text-primary neon-text">ChatSlot</span>
              <span className="text-xs text-muted-foreground font-mono">v1.0 // Terminal</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={cycleMode}
            className={`font-mono text-xs ${modeColor}`}
            data-testid="button-availability-mode"
          >
            <ModeIcon className="h-4 w-4 mr-1" />
            {modeLabel}
          </Button>
        </div>
      </SidebarHeader>
      
      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-primary/70">{"// "} {t("sidebar.main")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {getMainMenuItems(t).map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url} className="font-mono">
                    <Link href={item.url} data-testid={`link-${item.url.replace("/", "") || "dashboard"}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-primary/70">{"// "} {t("sidebar.whatsapp")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {getWhatsappMenuItems(t).map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url} className="font-mono">
                    <Link href={item.url} data-testid={`link-${item.url.replace("/", "")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-primary/70">{"// "} {t("sidebar.admin")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {getAdminMenuItems(t).map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={location === item.url} className="font-mono">
                    <Link href={item.url} data-testid={`link-${item.url.replace("/", "")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-primary/30">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 rounded-sm border border-primary/30">
            <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || t("common.name")} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-mono rounded-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-mono font-medium truncate text-primary">
              {user?.firstName} {user?.lastName}
            </span>
            <span className="text-xs text-muted-foreground font-mono truncate">
              {user?.email}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => logout()}
            className="rounded-sm"
            data-testid="button-logout"
            title={t("auth.logout")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 mb-2">
          <LanguageSelector />
        </div>
        <p className="text-xs text-primary/50 font-mono text-center neon-text">
          "{t("sidebar.crackTheCode")}"
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
