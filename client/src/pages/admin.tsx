import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  DollarSign,
  Calendar,
  Shield,
  Activity,
  Key,
  Zap,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Terminal,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const ADMIN_RED = "#FF3131";
const ADMIN_RED_80 = "#FF3131CC";
const ADMIN_RED_60 = "#FF313199";
const ADMIN_RED_40 = "#FF313166";
const ADMIN_RED_30 = "#FF31314D";
const ADMIN_RED_20 = "#FF313133";
const ADMIN_RED_10 = "#FF31311A";
const ADMIN_RED_05 = "#FF31310D";

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  createdAt: string;
  profile: {
    id: string;
    businessName: string;
    subscriptionStatus: string;
    whatsappConnected: boolean;
  } | null;
  appointmentCount: number;
}

interface AdminStats {
  totalUsers: number;
  activeSubscriptions: number;
  totalAppointments: number;
  confirmedAppointments: number;
  incallPercentage: number;
  outcallPercentage: number;
  topExtras: Array<{ name: string; count: number }>;
  safetyBlacklistCount: number;
  totalNoShows: number;
  estimatedMonthlyRevenue: number;
}

interface ActivityLog {
  id: string;
  eventType: string;
  description: string;
  metadata: any;
  createdAt: string;
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [deleteUserOpen, setDeleteUserOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const { data: isAdmin, isLoading: checkingAdmin } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
  });

  const { data: users, isLoading: loadingUsers } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin?.isAdmin === true,
  });

  const { data: stats, isLoading: loadingStats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: isAdmin?.isAdmin === true,
  });

  const { data: activityLogs, isLoading: loadingLogs } = useQuery<ActivityLog[]>({
    queryKey: ["/api/admin/activity-logs"],
    enabled: isAdmin?.isAdmin === true,
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const response = await apiRequest("POST", `/api/admin/users/${userId}/reset-password`, { newPassword });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Mot de passe réinitialisé", description: "Le mot de passe a été mis à jour avec succès." });
      setResetPasswordOpen(false);
      setNewPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity-logs"] });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de réinitialiser le mot de passe.", variant: "destructive" });
    },
  });

  const forceActivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("POST", `/api/admin/users/${userId}/force-activate`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Abonnement activé", description: "L'abonnement a été activé manuellement." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity-logs"] });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'activer l'abonnement.", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Utilisateur supprimé", description: "Le compte a été supprimé définitivement." });
      setDeleteUserOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/activity-logs"] });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de supprimer l'utilisateur.", variant: "destructive" });
    },
  });

  if (checkingAdmin) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="font-mono animate-pulse" style={{ color: ADMIN_RED }}>INITIALIZING COMMAND CENTER...</div>
      </div>
    );
  }

  if (!isAdmin?.isAdmin) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center font-mono">
          <AlertTriangle className="h-16 w-16 mx-auto mb-4" style={{ color: ADMIN_RED }} />
          <div className="text-2xl mb-2" style={{ color: ADMIN_RED }}>ACCESS DENIED</div>
          <div className="text-sm" style={{ color: ADMIN_RED_60 }}>ADMIN PRIVILEGES REQUIRED</div>
          <Button 
            variant="outline" 
            className="mt-6"
            style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}
            onClick={() => setLocation("/")}
            data-testid="button-back-home"
          >
            RETURN TO BASE
          </Button>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return <Badge variant="outline" className="border-gray-500 text-gray-500 font-mono text-xs">NO_PROFILE</Badge>;
    switch (status) {
      case "active":
        return <Badge className="font-mono text-xs" style={{ backgroundColor: "#39FF1433", color: "#39FF14CC", borderColor: "#39FF144D" }}>ACTIVE</Badge>;
      case "trial":
        return <Badge className="font-mono text-xs" style={{ backgroundColor: "#FFD70033", color: "#FFD700CC", borderColor: "#FFD7004D" }}>TRIAL</Badge>;
      case "cancelled":
        return <Badge className="font-mono text-xs" style={{ backgroundColor: ADMIN_RED_20, color: ADMIN_RED_80, borderColor: ADMIN_RED_30 }}>CANCELLED</Badge>;
      default:
        return <Badge variant="outline" className="border-gray-500 text-gray-500 font-mono text-xs">{status.toUpperCase()}</Badge>;
    }
  };

  const getEventIcon = (eventType: string) => {
    if (eventType.includes("USER")) return <Users className="h-3 w-3" />;
    if (eventType.includes("PASSWORD")) return <Key className="h-3 w-3" />;
    if (eventType.includes("ACTIVATE")) return <Zap className="h-3 w-3" />;
    if (eventType.includes("DELETE")) return <Trash2 className="h-3 w-3" />;
    if (eventType.includes("THREAT") || eventType.includes("SECURITY")) return <Shield className="h-3 w-3" />;
    return <Activity className="h-3 w-3" />;
  };

  return (
    <div className="min-h-screen bg-black font-mono p-6" style={{ color: ADMIN_RED }} data-testid="admin-dashboard">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 pb-4" style={{ borderBottomColor: ADMIN_RED_20, borderBottomWidth: 1 }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-wider" style={{ color: ADMIN_RED }}>COMMAND CENTER</h1>
              <p className="text-sm mt-1" style={{ color: ADMIN_RED_60 }}>SYSTEM ADMINISTRATOR: {user?.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: ADMIN_RED }} />
              <span className="text-xs" style={{ color: ADMIN_RED_80 }}>SYSTEM ONLINE</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="bg-black transition-colors" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>TOTAL_USERS</CardTitle>
              <Users className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" style={{ color: ADMIN_RED }} data-testid="stat-total-users">
                {loadingStats ? <Skeleton className="h-8 w-16" style={{ backgroundColor: ADMIN_RED_20 }} /> : stats?.totalUsers || 0}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black transition-colors" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>ACTIVE_SUBS</CardTitle>
              <Zap className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" style={{ color: ADMIN_RED }} data-testid="stat-active-subs">
                {loadingStats ? <Skeleton className="h-8 w-16" style={{ backgroundColor: ADMIN_RED_20 }} /> : stats?.activeSubscriptions || 0}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black transition-colors" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>TOTAL_RDV</CardTitle>
              <Calendar className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" style={{ color: ADMIN_RED }} data-testid="stat-total-rdv">
                {loadingStats ? <Skeleton className="h-8 w-16" style={{ backgroundColor: ADMIN_RED_20 }} /> : stats?.totalAppointments || 0}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black transition-colors" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>MONTHLY_REV</CardTitle>
              <DollarSign className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" style={{ color: ADMIN_RED }} data-testid="stat-monthly-revenue">
                {loadingStats ? (
                  <Skeleton className="h-8 w-24" style={{ backgroundColor: ADMIN_RED_20 }} />
                ) : (
                  `€${((stats?.estimatedMonthlyRevenue || 0) / 100).toFixed(2)}`
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <Card className="bg-black" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>SECURITY_NETWORK</CardTitle>
              <Shield className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: ADMIN_RED_60 }}>BLACKLIST_ENTRIES</span>
                <span style={{ color: ADMIN_RED_80 }} data-testid="stat-blacklist">{stats?.safetyBlacklistCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: ADMIN_RED_60 }}>TOTAL_NO_SHOWS</span>
                <span style={{ color: ADMIN_RED_80 }} data-testid="stat-noshows">{stats?.totalNoShows || 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>BOOKING_SPLIT</CardTitle>
              <Activity className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent className="space-y-2">
              {stats?.incallPercentage === -1 ? (
                <div className="text-xs" style={{ color: ADMIN_RED_40 }}>
                  DATA_NOT_TRACKED<br/>
                  <span className="text-[10px]">Requires appointment type field</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: ADMIN_RED_60 }}>INCALL (PRIVE)</span>
                    <span data-testid="stat-incall" style={{ color: ADMIN_RED_80 }}>{stats?.incallPercentage || 0}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: ADMIN_RED_60 }}>OUTCALL (ESCORT)</span>
                    <span data-testid="stat-outcall" style={{ color: ADMIN_RED_80 }}>{stats?.outcallPercentage || 0}%</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="bg-black" style={{ borderColor: ADMIN_RED_30 }}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-sm font-mono" style={{ color: ADMIN_RED_80 }}>TOP_EXTRAS</CardTitle>
              <Zap className="h-4 w-4" style={{ color: ADMIN_RED }} />
            </CardHeader>
            <CardContent className="space-y-1">
              {stats?.topExtras?.length ? (
                stats.topExtras.map((extra, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="truncate max-w-[150px]" style={{ color: ADMIN_RED_60 }}>{extra.name}</span>
                    <span style={{ color: ADMIN_RED_80 }}>{extra.count}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs" style={{ color: ADMIN_RED_40 }}>NO_DATA</span>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card className="bg-black" style={{ borderColor: ADMIN_RED_30 }}>
              <CardHeader>
                <CardTitle className="font-mono flex items-center gap-2" style={{ color: ADMIN_RED }}>
                  <Users className="h-5 w-5" />
                  USER_REGISTRY
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="users-table">
                    <thead>
                      <tr style={{ borderBottomColor: ADMIN_RED_20, borderBottomWidth: 1, color: ADMIN_RED_60 }}>
                        <th className="text-left py-2 px-2">EMAIL</th>
                        <th className="text-left py-2 px-2">JOINED</th>
                        <th className="text-left py-2 px-2">STATUS</th>
                        <th className="text-left py-2 px-2">RDV</th>
                        <th className="text-right py-2 px-2">ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingUsers ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i} style={{ borderBottomColor: ADMIN_RED_10, borderBottomWidth: 1 }}>
                            <td colSpan={5} className="py-3">
                              <Skeleton className="h-4 w-full" style={{ backgroundColor: ADMIN_RED_10 }} />
                            </td>
                          </tr>
                        ))
                      ) : users?.length ? (
                        users.map((u) => (
                          <tr key={u.id} style={{ borderBottomColor: ADMIN_RED_10, borderBottomWidth: 1 }}>
                            <td className="py-2 px-2" style={{ color: ADMIN_RED_80 }} data-testid={`user-email-${u.id}`}>
                              {u.email}
                              {u.role === "ADMIN" && (
                                <Badge className="ml-2 text-[10px]" style={{ backgroundColor: ADMIN_RED_20, color: ADMIN_RED_80, borderColor: ADMIN_RED }}>ADMIN</Badge>
                              )}
                            </td>
                            <td className="py-2 px-2" style={{ color: ADMIN_RED_60 }}>
                              {format(new Date(u.createdAt), "dd/MM/yy", { locale: fr })}
                            </td>
                            <td className="py-2 px-2">
                              {getStatusBadge(u.profile?.subscriptionStatus)}
                            </td>
                            <td className="py-2 px-2" style={{ color: ADMIN_RED_80 }}>{u.appointmentCount}</td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  style={{ color: ADMIN_RED }}
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setResetPasswordOpen(true);
                                  }}
                                  data-testid={`button-reset-pwd-${u.id}`}
                                >
                                  <Key className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  style={{ color: "#39FF14" }}
                                  onClick={() => forceActivateMutation.mutate(u.id)}
                                  disabled={forceActivateMutation.isPending || u.profile?.subscriptionStatus === "active"}
                                  data-testid={`button-force-activate-${u.id}`}
                                >
                                  <Zap className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  style={{ color: ADMIN_RED }}
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setDeleteUserOpen(true);
                                  }}
                                  disabled={u.role === "ADMIN"}
                                  data-testid={`button-delete-user-${u.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-4 text-center" style={{ color: ADMIN_RED_40 }}>
                            NO_USERS_FOUND
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="bg-black" style={{ borderColor: ADMIN_RED_30 }}>
              <CardHeader>
                <CardTitle className="font-mono flex items-center gap-2" style={{ color: ADMIN_RED }}>
                  <Terminal className="h-5 w-5" />
                  LIVE_ACTIVITY
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[400px] overflow-y-auto" data-testid="activity-logs">
                  {loadingLogs ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" style={{ backgroundColor: ADMIN_RED_10 }} />
                    ))
                  ) : activityLogs?.length ? (
                    activityLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-2 rounded text-xs"
                        style={{ borderColor: ADMIN_RED_20, borderWidth: 1, backgroundColor: ADMIN_RED_05 }}
                      >
                        <div className="flex items-center gap-2 mb-1" style={{ color: ADMIN_RED_80 }}>
                          {getEventIcon(log.eventType)}
                          <span className="font-semibold">{log.eventType}</span>
                        </div>
                        <div className="truncate" style={{ color: ADMIN_RED_60 }}>{log.description}</div>
                        <div className="text-[10px] mt-1" style={{ color: ADMIN_RED_40 }}>
                          {format(new Date(log.createdAt), "dd/MM HH:mm:ss")}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4" style={{ color: ADMIN_RED_40 }}>
                      NO_ACTIVITY_LOGGED
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-4"
                  style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/activity-logs"] })}
                  data-testid="button-refresh-logs"
                >
                  <RefreshCw className="h-3 w-3 mr-2" />
                  REFRESH
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
          <DialogContent className="bg-black font-mono" style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}>
            <DialogHeader>
              <DialogTitle style={{ color: ADMIN_RED }}>RESET_PASSWORD</DialogTitle>
              <DialogDescription style={{ color: ADMIN_RED_60 }}>
                Entrez un nouveau mot de passe pour {selectedUser?.email}
              </DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              placeholder="Nouveau mot de passe (min. 8 caractères)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-black"
              style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}
              data-testid="input-new-password"
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setResetPasswordOpen(false)}
                style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}
                data-testid="button-cancel-reset"
              >
                CANCEL
              </Button>
              <Button
                onClick={() => {
                  if (selectedUser && newPassword.length >= 8) {
                    resetPasswordMutation.mutate({ userId: selectedUser.id, newPassword });
                  }
                }}
                disabled={newPassword.length < 8 || resetPasswordMutation.isPending}
                style={{ backgroundColor: ADMIN_RED, color: "black" }}
                data-testid="button-confirm-reset"
              >
                {resetPasswordMutation.isPending ? "PROCESSING..." : "CONFIRM"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteUserOpen} onOpenChange={setDeleteUserOpen}>
          <DialogContent className="bg-black font-mono" style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2" style={{ color: ADMIN_RED }}>
                <AlertTriangle className="h-5 w-5" />
                DELETE_USER
              </DialogTitle>
              <DialogDescription style={{ color: ADMIN_RED_60 }}>
                Cette action est irréversible. Toutes les données associées à {selectedUser?.email} seront supprimées définitivement.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteUserOpen(false)}
                style={{ borderColor: ADMIN_RED_30, color: ADMIN_RED }}
                data-testid="button-cancel-delete"
              >
                CANCEL
              </Button>
              <Button
                onClick={() => {
                  if (selectedUser) {
                    deleteUserMutation.mutate(selectedUser.id);
                  }
                }}
                disabled={deleteUserMutation.isPending}
                style={{ backgroundColor: ADMIN_RED, color: "black" }}
                data-testid="button-confirm-delete"
              >
                {deleteUserMutation.isPending ? "DELETING..." : "CONFIRM_DELETE"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
