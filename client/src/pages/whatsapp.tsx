import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  QrCode, 
  RefreshCw, 
  Check, 
  X, 
  Smartphone,
  Wifi,
  WifiOff,
  AlertTriangle,
  Lock,
  CreditCard,
  Zap
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import type { ProviderProfile, Slot } from "@shared/schema";

interface WhatsAppStatus {
  connected: boolean;
  qrCode?: string;
  phoneNumber?: string;
  lastSeen?: string;
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [activeSlotId, setActiveSlotId] = useState<string | undefined>(undefined);

  const { data: profile, isLoading: profileLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });

  const isSubscribed = profile?.subscriptionStatus === 'active';

  const { data: slotsData } = useQuery<Slot[]>({
    queryKey: ["/api/slots"],
    enabled: isSubscribed,
  });

  useEffect(() => {
    if (slotsData && slotsData.length > 0 && !activeSlotId) {
      const stored = localStorage.getItem("activeSlotId");
      if (stored && slotsData.some(s => s.id === stored)) {
        setActiveSlotId(stored);
      } else {
        setActiveSlotId(slotsData[0].id);
      }
    }
  }, [slotsData, activeSlotId]);

  useEffect(() => {
    if (activeSlotId) {
      localStorage.setItem("activeSlotId", activeSlotId);
    }
  }, [activeSlotId]);

  const { data: status, isLoading, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status", { slotId: activeSlotId }],
    refetchInterval: pollingEnabled && isSubscribed && activeSlotId ? 3000 : false,
    enabled: isSubscribed && !!activeSlotId,
  });


  useEffect(() => {
    if (status?.connected) {
      setPollingEnabled(false);
    }
  }, [status?.connected]);

  useEffect(() => {
    setPollingEnabled(true);
  }, [activeSlotId]);

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/disconnect", { slotId: activeSlotId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status", { slotId: activeSlotId }] });
      queryClient.invalidateQueries({ queryKey: ["/api/slots"] });
      toast({ title: "Succes", description: "WhatsApp deconnecte" });
      setPollingEnabled(true);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de deconnecter WhatsApp", variant: "destructive" });
    },
  });

  const refreshQRMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/whatsapp/refresh-qr", { slotId: activeSlotId });
      return res.json();
    },
    onSuccess: (data: WhatsAppStatus) => {
      queryClient.setQueryData(["/api/whatsapp/status", { slotId: activeSlotId }], data);
      if (data.qrCode) {
        toast({ title: "QR Code pret", description: "Scannez avec WhatsApp" });
      } else {
        toast({ title: "Erreur QR", description: "Erreur QR - reessayez", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Erreur", description: "Erreur QR - reessayez", variant: "destructive" });
    },
  });

  const forceReconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/whatsapp/force-reconnect", { slotId: activeSlotId });
      return res.json();
    },
    onSuccess: (data: WhatsAppStatus) => {
      queryClient.setQueryData(["/api/whatsapp/status", { slotId: activeSlotId }], data);
      setPollingEnabled(true);
      toast({ title: "Succes", description: "Reconnexion en cours..." });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de reconnecter", variant: "destructive" });
    },
  });

  const activeSlot = slotsData?.find(s => s.id === activeSlotId);

  const renderPaymentRequired = () => (
    <div className="text-center space-y-6 py-8">
      <div className="h-32 w-32 mx-auto rounded-full bg-[#39FF14]/10 border-2 border-[#39FF14]/30 flex items-center justify-center">
        <Lock className="h-16 w-16 text-[#39FF14]" />
      </div>
      <div className="space-y-3">
        <p className="font-mono text-[#39FF14] text-lg font-bold">
          PAIEMENT REQUIS
        </p>
        <p className="text-muted-foreground max-w-sm mx-auto">
          Veuillez vous abonner pour activer votre bot
        </p>
        <Zap className="h-6 w-6 text-[#39FF14] mx-auto animate-pulse" />
      </div>
      <Link href="/abonnement">
        <Button className="bg-[#39FF14] text-black hover:bg-[#39FF14]/80 font-mono" data-testid="button-subscribe-redirect">
          <CreditCard className="h-4 w-4 mr-2" />
          S'ABONNER MAINTENANT
        </Button>
      </Link>
    </div>
  );

  const renderNoSlots = () => (
    <div className="text-center space-y-6 py-8">
      <div className="h-32 w-32 mx-auto rounded-full bg-[#39FF14]/10 border-2 border-[#39FF14]/30 flex items-center justify-center">
        <Smartphone className="h-16 w-16 text-[#39FF14]" />
      </div>
      <div className="space-y-3">
        <p className="font-mono text-[#39FF14] text-lg font-bold">
          AUCUN NUMERO CONFIGURE
        </p>
        <p className="text-muted-foreground max-w-sm mx-auto">
          Creez un slot dans la configuration pour connecter un numero WhatsApp
        </p>
      </div>
      <Link href="/configuration">
        <Button className="bg-[#39FF14] text-black hover:bg-[#39FF14]/80 font-mono" data-testid="button-config-redirect">
          CONFIGURER UN SLOT
        </Button>
      </Link>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-whatsapp-title">Connexion WhatsApp</h1>
          <p className="text-muted-foreground">
            Connectez vos numeros WhatsApp pour activer les bots
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSubscribed && slotsData && slotsData.length > 0 && (
            <Select value={activeSlotId} onValueChange={(val) => setActiveSlotId(val)} data-testid="select-slot">
              <SelectTrigger className="w-[200px] font-mono border-[#39FF14]/30" data-testid="select-slot-trigger">
                <SelectValue placeholder="Choisir un slot" />
              </SelectTrigger>
              <SelectContent>
                {slotsData.map(slot => (
                  <SelectItem key={slot.id} value={slot.id} data-testid={`select-slot-${slot.id}`}>
                    {slot.name} {slot.whatsappConnected ? "  [ON]" : "  [OFF]"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {profileLoading || isLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : !isSubscribed ? (
            <Badge variant="destructive">
              <Lock className="h-3 w-3 mr-1" />
              Abonnement requis
            </Badge>
          ) : status?.connected ? (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <Wifi className="h-3 w-3 mr-1" />
              Connecte
            </Badge>
          ) : (
            <Badge variant="secondary">
              <WifiOff className="h-3 w-3 mr-1" />
              Deconnecte
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SiWhatsapp className="h-5 w-5 text-primary" />
              {activeSlot ? `${activeSlot.name}` : "Etat de la connexion"}
            </CardTitle>
            <CardDescription>
              {!isSubscribed 
                ? "Abonnez-vous pour activer le bot WhatsApp"
                : !activeSlotId
                  ? "Selectionnez un slot pour gerer sa connexion WhatsApp"
                  : status?.connected 
                    ? `${activeSlot?.name || "Slot"} est connecte et le bot est actif`
                    : `Scannez le QR Code pour connecter ${activeSlot?.name || "ce slot"}`
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center py-8">
            {profileLoading ? (
              <Skeleton className="h-64 w-64" />
            ) : !isSubscribed ? (
              renderPaymentRequired()
            ) : !slotsData || slotsData.length === 0 ? (
              renderNoSlots()
            ) : !activeSlotId ? (
              <p className="text-muted-foreground">Selectionnez un slot ci-dessus</p>
            ) : isLoading ? (
              <Skeleton className="h-64 w-64" />
            ) : status?.connected ? (
              <div className="text-center space-y-6">
                <div className="h-32 w-32 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="h-16 w-16 text-green-600" />
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-lg">WhatsApp connecte</p>
                  {status.phoneNumber && (
                    <p className="text-muted-foreground flex items-center justify-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      {status.phoneNumber}
                    </p>
                  )}
                  {activeSlot && (
                    <p className="text-sm text-muted-foreground font-mono">
                      Slot: {activeSlot.name}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="text-destructive hover:text-destructive"
                  data-testid="button-disconnect"
                >
                  <X className="h-4 w-4 mr-2" />
                  {disconnectMutation.isPending ? "Deconnexion..." : "Deconnecter"}
                </Button>
              </div>
            ) : status?.qrCode ? (
              <div className="text-center space-y-6">
                <div className="p-4 bg-white rounded-lg inline-block">
                  <img
                    src={status.qrCode}
                    alt="QR Code WhatsApp"
                    className="h-64 w-64"
                    data-testid="img-qr-code"
                  />
                </div>
                <div className="space-y-2">
                  <p className="font-medium">Scannez ce QR Code pour {activeSlot?.name || "ce slot"}</p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Ouvrez WhatsApp sur votre telephone, allez dans Parametres - Appareils lies - Lier un appareil
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => refreshQRMutation.mutate()}
                  disabled={refreshQRMutation.isPending}
                  data-testid="button-refresh-qr"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${refreshQRMutation.isPending ? "animate-spin" : ""}`} />
                  Actualiser le QR Code
                </Button>
              </div>
            ) : (
              <div className="text-center space-y-6">
                <div className="h-32 w-32 mx-auto rounded-full bg-black border-2 border-[#39FF14] flex items-center justify-center animate-pulse">
                  <QrCode className="h-16 w-16 text-[#39FF14]" />
                </div>
                <div className="space-y-3">
                  <p className="font-mono text-[#39FF14] text-lg font-bold tracking-wider">
                    [ SYSTEM_BOOTING... ]
                  </p>
                  <p className="font-mono text-[#39FF14]/70 text-sm">
                    [ PLEASE_WAIT_UP_TO_60S ]
                  </p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Initialisation du navigateur securise en cours...
                  </p>
                </div>
                <div className="flex flex-col gap-2 items-center">
                  <Button
                    variant="outline"
                    onClick={() => refetch()}
                    className="border-[#39FF14]/50 text-[#39FF14] hover:bg-[#39FF14]/10"
                    data-testid="button-retry"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Verifier
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => forceReconnectMutation.mutate()}
                    disabled={forceReconnectMutation.isPending}
                    className="text-muted-foreground hover:text-[#39FF14]"
                    data-testid="button-force-reconnect"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${forceReconnectMutation.isPending ? "animate-spin" : ""}`} />
                    {forceReconnectMutation.isPending ? "Reconnexion..." : "Forcer reconnexion"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Comment ca fonctionne ?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  1
                </div>
                <div>
                  <p className="font-medium">Selectionnez un slot</p>
                  <p className="text-sm text-muted-foreground">
                    Choisissez le numero a connecter dans le menu deroulant
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  2
                </div>
                <div>
                  <p className="font-medium">Scannez le QR Code</p>
                  <p className="text-sm text-muted-foreground">
                    Utilisez l'application WhatsApp sur votre telephone pour scanner le code
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  3
                </div>
                <div>
                  <p className="font-medium">Bot actif 24/7</p>
                  <p className="text-sm text-muted-foreground">
                    Chaque slot a son propre bot independant. Repetez pour chaque numero.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Important
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Chaque slot est connecte independamment. Pas de melange entre les numeros.
              </p>
              <p>
                Gardez votre telephone connecte a Internet pour maintenir la session WhatsApp active.
              </p>
              <p>
                Le bot se reconnecte automatiquement apres un redemarrage du serveur.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
