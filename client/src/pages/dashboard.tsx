import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Calendar, 
  Users, 
  CheckCircle, 
  XCircle,
  Clock,
  TrendingUp,
  MessageSquare,
  ShieldAlert
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import type { Appointment, Service, ProviderProfile } from "@shared/schema";

interface DashboardStats {
  todayAppointments: number;
  weekAppointments: number;
  completedThisMonth: number;
  noShowsThisMonth: number;
  totalClients: number;
  messagesThisWeek: number;
  dangerousClientsFiltered?: number;
}

interface UpcomingAppointment extends Appointment {
  service?: Service;
}

export default function DashboardPage() {
  const { data: profile, isLoading: profileLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/extended-stats"],
  });

  const { data: upcomingAppointments, isLoading: appointmentsLoading } = useQuery<UpcomingAppointment[]>({
    queryKey: ["/api/appointments/upcoming"],
  });

  const statCards = [
    {
      title: "RDV aujourd'hui",
      value: stats?.todayAppointments ?? 0,
      icon: Calendar,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "RDV cette semaine",
      value: stats?.weekAppointments ?? 0,
      icon: TrendingUp,
      color: "text-blue-600",
      bgColor: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      title: "Terminés ce mois",
      value: stats?.completedThisMonth ?? 0,
      icon: CheckCircle,
      color: "text-green-600",
      bgColor: "bg-green-100 dark:bg-green-900/30",
    },
    {
      title: "No-shows ce mois",
      value: stats?.noShowsThisMonth ?? 0,
      icon: XCircle,
      color: "text-red-600",
      bgColor: "bg-red-100 dark:bg-red-900/30",
    },
    {
      title: "Profils dangereux ecartes",
      value: stats?.dangerousClientsFiltered ?? 0,
      icon: ShieldAlert,
      color: "text-red-500",
      bgColor: "bg-red-500/10",
      special: true,
    },
  ];

  const formatAppointmentDate = (dateStr: string | Date) => {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    if (isToday(date)) {
      return `Aujourd'hui à ${format(date, "HH:mm", { locale: fr })}`;
    }
    if (isTomorrow(date)) {
      return `Demain à ${format(date, "HH:mm", { locale: fr })}`;
    }
    return format(date, "EEEE d MMM à HH:mm", { locale: fr });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Tableau de bord</h1>
          <p className="text-muted-foreground">
            Bienvenue sur ChatSlot{profile?.businessName ? `, ${profile.businessName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {profileLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : profile?.whatsappConnected ? (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <SiWhatsapp className="h-3 w-3 mr-1" />
              WhatsApp connecté
            </Badge>
          ) : (
            <Badge variant="secondary">
              <SiWhatsapp className="h-3 w-3 mr-1" />
              WhatsApp non connecté
            </Badge>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((stat, index) => (
          <Card key={index} className={(stat as any).special ? "border-red-500/50" : ""}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  {statsLoading ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    <p className={`text-3xl font-bold ${(stat as any).special ? "text-red-500" : ""}`} data-testid={`text-stat-${index}`}>
                      {stat.value}
                    </p>
                  )}
                  {(stat as any).special && stat.value > 0 && (
                    <p className="text-xs text-red-400">Votre securite: protection active</p>
                  )}
                </div>
                <div className={`h-12 w-12 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Appointments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <CardTitle className="text-lg font-semibold">Prochains rendez-vous</CardTitle>
            <Badge variant="secondary" className="text-xs">
              <Calendar className="h-3 w-3 mr-1" />
              À venir
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {appointmentsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : upcomingAppointments && upcomingAppointments.length > 0 ? (
              upcomingAppointments.slice(0, 5).map((apt) => (
                <div 
                  key={apt.id} 
                  className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                  data-testid={`appointment-${apt.id}`}
                >
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{apt.clientName || apt.clientPhone}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {apt.service?.name || "Service"} • {apt.duration} min
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-medium">
                      {formatAppointmentDate(apt.appointmentDate)}
                    </p>
                    <Badge 
                      variant={apt.status === "confirmed" ? "default" : "secondary"} 
                      className="text-xs mt-1"
                    >
                      {apt.status === "confirmed" ? "Confirmé" : apt.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Aucun rendez-vous à venir</p>
                <p className="text-sm mt-1">Les réservations de vos clients apparaîtront ici</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats & Actions */}
        <div className="space-y-6">
          {/* Messages Stats */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
              <CardTitle className="text-lg font-semibold">Activité WhatsApp</CardTitle>
              <Badge variant="secondary" className="text-xs">
                <MessageSquare className="h-3 w-3 mr-1" />
                Cette semaine
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
                  <SiWhatsapp className="h-8 w-8 text-primary" />
                </div>
                <div>
                  {statsLoading ? (
                    <Skeleton className="h-10 w-20" />
                  ) : (
                    <p className="text-4xl font-bold" data-testid="text-messages-count">
                      {stats?.messagesThisWeek ?? 0}
                    </p>
                  )}
                  <p className="text-muted-foreground">messages échangés</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Client Stats */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
              <CardTitle className="text-lg font-semibold">Clients</CardTitle>
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                Total
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="h-16 w-16 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Users className="h-8 w-8 text-blue-600" />
                </div>
                <div>
                  {statsLoading ? (
                    <Skeleton className="h-10 w-20" />
                  ) : (
                    <p className="text-4xl font-bold" data-testid="text-clients-count">
                      {stats?.totalClients ?? 0}
                    </p>
                  )}
                  <p className="text-muted-foreground">clients uniques</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
