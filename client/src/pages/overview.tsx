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
  Hand
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Slot, ProviderProfile } from "@shared/schema";

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

function SlotCard({ slot }: { slot: Slot }) {
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
          
          <div className="flex items-center gap-1">
            {slot.whatsappConnected ? (
              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50" data-testid={`badge-whatsapp-connected-${slot.id}`}>
                <SiWhatsapp className="h-3 w-3 mr-1" />
                <Wifi className="h-3 w-3" />
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-muted text-muted-foreground" data-testid={`badge-whatsapp-disconnected-${slot.id}`}>
                <SiWhatsapp className="h-3 w-3 mr-1" />
                <WifiOff className="h-3 w-3" />
              </Badge>
            )}
          </div>
        </div>
        
        {slot.phone && (
          <div className="font-mono text-xs text-muted-foreground truncate" data-testid={`text-slot-phone-${slot.id}`}>
            {slot.phone}
          </div>
        )}
        
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1 font-mono text-xs"
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
        </div>
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
      
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="grid-slots">
        {slotsList?.map((slot) => (
          <SlotCard key={slot.id} slot={slot} />
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
