import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Plus,
  Zap,
  Moon,
  Ghost,
  Wifi,
  WifiOff,
  Settings,
  Hand,
  QrCode,
  RefreshCw,
  X,
  Smartphone,
  Lock,
  CreditCard,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Slot, ProviderProfile } from "@shared/schema";

interface WhatsAppStatus {
  connected: boolean;
  qrCode?: string;
  phoneNumber?: string;
}

const STATUS_CONFIG = {
  active: { 
    icon: Zap, 
    label: "ACTIVE", 
    className: "bg-primary/20 text-primary border-primary/50" 
  },
  away: { 
    icon: Moon, 
    label: "AWAY", 
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/50" 
  },
  ghost: { 
    icon: Ghost, 
    label: "GHOST", 
    className: "bg-muted text-muted-foreground border-muted" 
  },
} as const;

function SlotWhatsAppPanel({ slot, isSubscribed }: { slot: Slot; isSubscribed: boolean }) {
  const { toast } = useToast();
  const [polling, setPolling] = useState(false);

  const { data: status, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status", { slotId: slot.id }],
    queryFn: () => fetch(`/api/whatsapp/status?slotId=${slot.id}`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: polling ? 3000 : false,
    enabled: isSubscribed,
  });

  useEffect(() => {
    if (status?.connected) {
      setPolling(false);
      queryClient.invalidateQueries({ queryKey: ["/api/slots"] });
    }
  }, [status?.connected]);

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/connect", { slotId: slot.id }),
    onSuccess: () => {
      setPolling(true);
      refetch();
      toast({ title: "Connexion lancee", description: "QR Code en cours de generation..." });
    },
    onError: (error: any) => {
      toast({ title: "Erreur", description: error.message || "Impossible de connecter", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/disconnect", { slotId: slot.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status", { slotId: slot.id }] });
      queryClient.invalidateQueries({ queryKey: ["/api/slots"] });
      toast({ title: "Deconnecte" });
      setPolling(false);
    },
  });

  const forceReconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/force-reconnect", { slotId: slot.id }),
    onSuccess: () => {
      setPolling(true);
      refetch();
      toast({ title: "Reconnexion en cours..." });
    },
  });

  if (!isSubscribed) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        <span>Abonnement requis</span>
      </div>
    );
  }

  if (status?.connected || slot.whatsappConnected) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50 text-xs" data-testid={`badge-wa-online-${slot.id}`}>
            <SiWhatsapp className="h-3 w-3 mr-1" />
            <Wifi className="h-3 w-3 mr-1" />
            ON
          </Badge>
          {status?.phoneNumber && (
            <span className="font-mono text-xs text-muted-foreground">{status.phoneNumber}</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          className="w-full font-mono text-xs text-destructive"
          data-testid={`button-wa-disconnect-${slot.id}`}
        >
          <X className="h-3 w-3 mr-1" />
          {disconnectMutation.isPending ? "..." : "Deconnecter"}
        </Button>
      </div>
    );
  }

  if (status?.qrCode) {
    return (
      <div className="space-y-2 text-center">
        <div className="p-2 bg-white rounded inline-block">
          <img
            src={status.qrCode}
            alt="QR Code"
            className="h-40 w-40"
            data-testid={`img-qr-${slot.id}`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Scannez avec WhatsApp
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="font-mono text-xs"
          data-testid={`button-refresh-qr-${slot.id}`}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Actualiser
        </Button>
      </div>
    );
  }

  if (polling) {
    return (
      <div className="space-y-2 text-center">
        <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center animate-pulse">
          <QrCode className="h-8 w-8 text-primary" />
        </div>
        <p className="font-mono text-xs text-primary">INITIALISATION...</p>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="font-mono text-xs flex-1"
            data-testid={`button-check-${slot.id}`}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Verifier
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => forceReconnectMutation.mutate()}
            disabled={forceReconnectMutation.isPending}
            className="font-mono text-xs flex-1"
            data-testid={`button-force-${slot.id}`}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${forceReconnectMutation.isPending ? "animate-spin" : ""}`} />
            Forcer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => connectMutation.mutate()}
      disabled={connectMutation.isPending}
      className="w-full font-mono text-xs border-primary/30 text-primary"
      data-testid={`button-wa-connect-${slot.id}`}
    >
      <SiWhatsapp className="h-3 w-3 mr-1" />
      {connectMutation.isPending ? "Connexion..." : "Connecter WhatsApp"}
    </Button>
  );
}

function SlotCard({ slot, isSubscribed }: { slot: Slot; isSubscribed: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const status = (slot.availabilityMode || "active") as keyof typeof STATUS_CONFIG;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.active;
  const StatusIcon = config.icon;
  
  const isManualOverride = slot.manualOverrideUntil && new Date(slot.manualOverrideUntil) > new Date();
  
  const toggleOverrideMutation = useMutation({
    mutationFn: async () => {
      if (isManualOverride) {
        await apiRequest("DELETE", `/api/slots/${slot.id}/manual-override`);
      } else {
        await apiRequest("POST", `/api/slots/${slot.id}/manual-override`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slots"] });
      toast({
        title: isManualOverride ? t("overview.botResumed") : t("overview.manualOverrideActive"),
        description: isManualOverride ? t("overview.botResumedDesc") : t("overview.manualOverrideDesc"),
      });
    },
  });

  return (
    <Card className="border-primary/30 hover:border-primary/60 transition-all" data-testid={`card-slot-${slot.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <div className="font-mono font-bold text-lg text-foreground truncate max-w-[150px]" data-testid={`text-slot-name-${slot.id}`}>
            {slot.name}
          </div>
          {isManualOverride && (
            <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/50 text-xs" data-testid={`badge-manual-${slot.id}`}>
              <Hand className="h-3 w-3 mr-1" />
              MANUAL
            </Badge>
          )}
        </div>
        <Link href={`/slots/${slot.id}`}>
          <Button variant="ghost" size="icon" data-testid={`button-settings-${slot.id}`}>
            <Settings className="h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={`font-mono text-xs ${config.className}`} data-testid={`badge-status-${slot.id}`}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {config.label}
          </Badge>
        </div>
        
        {slot.phone && (
          <div className="font-mono text-xs text-muted-foreground truncate" data-testid={`text-slot-phone-${slot.id}`}>
            {slot.phone}
          </div>
        )}

        <div className="border-t border-primary/10 pt-3">
          <SlotWhatsAppPanel slot={slot} isSubscribed={isSubscribed} />
        </div>
        
        <Button 
          variant="outline" 
          className="w-full font-mono text-xs"
          onClick={() => toggleOverrideMutation.mutate()}
          disabled={toggleOverrideMutation.isPending}
          data-testid={`button-override-${slot.id}`}
        >
          {isManualOverride ? (
            <>
              <Zap className="h-3 w-3 mr-1" />
              {t("overview.resumeBot")}
            </>
          ) : (
            <>
              <Hand className="h-3 w-3 mr-1" />
              {t("overview.takeControl")}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function AddSlotCard({ maxSlots, currentCount }: { maxSlots: number; currentCount: number }) {
  const { t } = useTranslation();
  const canAdd = currentCount < maxSlots;
  
  if (!canAdd) {
    return (
      <Card className="border-dashed border-muted/50 bg-muted/10" data-testid="card-slot-limit-reached">
        <CardContent className="flex flex-col items-center justify-center h-full min-h-[180px] text-center p-6">
          <div className="font-mono text-sm text-muted-foreground mb-2" data-testid="text-limit-reached">
            {t("overview.limitReached")}
          </div>
          <div className="font-mono text-xs text-muted-foreground mb-4" data-testid="text-slots-count-limit">
            {currentCount}/{maxSlots} {t("overview.slotsUsed")}
          </div>
          <Link href="/abonnement">
            <Button variant="outline" className="font-mono" data-testid="button-upgrade-plan">
              {t("overview.upgradePlan")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Link href="/slots/new" data-testid="link-add-slot">
      <Card className="border-dashed border-primary/30 hover:border-primary/60 transition-all cursor-pointer hover-elevate" data-testid="card-add-slot">
        <CardContent className="flex flex-col items-center justify-center h-full min-h-[180px] text-center p-6">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <div className="font-mono text-sm text-primary mb-1" data-testid="text-add-slot">
            {t("overview.addSlot")}
          </div>
          <div className="font-mono text-xs text-muted-foreground" data-testid="text-slots-count-add">
            {currentCount}/{maxSlots} {t("overview.slotsUsed")}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function OverviewPage() {
  const { t } = useTranslation();
  
  const { data: profile, isLoading: profileLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });
  
  const { data: slotsList, isLoading: slotsLoading } = useQuery<Slot[]>({
    queryKey: ["/api/slots"],
  });
  
  const maxSlots = profile?.maxSlots || 1;
  const currentCount = slotsList?.length || 0;
  const isSubscribed = profile?.subscriptionStatus === "active";
  
  if (profileLoading || slotsLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="loading-overview">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[180px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="overview-page">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-mono text-2xl font-bold text-primary" data-testid="text-overview-title">
            {t("overview.title")}
          </h1>
          <p className="font-mono text-sm text-muted-foreground" data-testid="text-overview-subtitle">
            {t("overview.subtitle")}
          </p>
        </div>
        <Badge variant="outline" className="font-mono" data-testid="badge-slots-count">
          {currentCount}/{maxSlots} {t("overview.slots")}
        </Badge>
      </div>

      {!isSubscribed && (
        <Card className="border-yellow-500/30 bg-yellow-500/5" data-testid="card-subscribe-cta">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="font-mono text-sm font-bold">Abonnement requis</p>
                <p className="text-xs text-muted-foreground">Abonnez-vous pour activer vos bots WhatsApp</p>
              </div>
            </div>
            <Link href="/abonnement">
              <Button size="sm" className="font-mono" data-testid="button-subscribe-overview">
                <CreditCard className="h-4 w-4 mr-1" />
                S'abonner
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
      
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="grid-slots">
        {slotsList?.map((slot) => (
          <SlotCard key={slot.id} slot={slot} isSubscribed={isSubscribed} />
        ))}
        <AddSlotCard maxSlots={maxSlots} currentCount={currentCount} />
      </div>
      
      {slotsList?.length === 0 && (
        <Card className="border-primary/30" data-testid="card-no-slots">
          <CardContent className="p-8 text-center">
            <div className="font-mono text-lg text-muted-foreground mb-4" data-testid="text-no-slots">
              {t("overview.noSlots")}
            </div>
            <p className="text-sm text-muted-foreground mb-6" data-testid="text-no-slots-desc">
              {t("overview.noSlotsDesc")}
            </p>
            <Link href="/slots/new">
              <Button className="font-mono" data-testid="button-create-first-slot">
                <Plus className="h-4 w-4 mr-2" />
                {t("overview.createFirstSlot")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
