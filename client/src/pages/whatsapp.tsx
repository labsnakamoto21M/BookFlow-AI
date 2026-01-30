import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { ProviderProfile } from "@shared/schema";

interface WhatsAppStatus {
  connected: boolean;
  qrCode?: string;
  phoneNumber?: string;
  lastSeen?: string;
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const [pollingEnabled, setPollingEnabled] = useState(true);

  const { data: profile, isLoading: profileLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });

  const isSubscribed = profile?.subscriptionStatus === 'active';

  const { data: status, isLoading, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: pollingEnabled && isSubscribed ? 3000 : false,
    enabled: isSubscribed,
  });

  useEffect(() => {
    if (status?.connected) {
      setPollingEnabled(false);
    }
  }, [status?.connected]);

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      toast({ title: "Succes", description: "WhatsApp deconnecte" });
      setPollingEnabled(true);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de deconnecter WhatsApp", variant: "destructive" });
    },
  });

  const refreshQRMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/refresh-qr"),
    onSuccess: () => {
      refetch();
      toast({ title: "Succes", description: "QR Code actualise" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'actualiser le QR Code", variant: "destructive" });
    },
  });

  const forceReconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/force-reconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
      setPollingEnabled(true);
      toast({ title: "Succes", description: "Reconnexion en cours..." });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de reconnecter", variant: "destructive" });
    },
  });

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-whatsapp-title">Connexion WhatsApp</h1>
          <p className="text-muted-foreground">
            Connectez votre compte WhatsApp pour activer le bot
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              Etat de la connexion
            </CardTitle>
            <CardDescription>
              {!isSubscribed 
                ? "Abonnez-vous pour activer le bot WhatsApp"
                : status?.connected 
                  ? "Votre WhatsApp est connecte et le bot est actif"
                  : "Scannez le QR Code avec WhatsApp pour connecter votre compte"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center py-8">
            {profileLoading ? (
              <Skeleton className="h-64 w-64" />
            ) : !isSubscribed ? (
              renderPaymentRequired()
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
                  <p className="font-medium">Scannez ce QR Code</p>
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
                  <p className="font-medium">Scannez le QR Code</p>
                  <p className="text-sm text-muted-foreground">
                    Utilisez l'application WhatsApp sur votre telephone pour scanner le code
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  2
                </div>
                <div>
                  <p className="font-medium">Connexion automatique</p>
                  <p className="text-sm text-muted-foreground">
                    Une fois scanne, votre compte sera connecte automatiquement
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
                    Le bot repond automatiquement aux messages et gere vos reservations
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
                Gardez votre telephone connecte a Internet pour maintenir la session WhatsApp active.
              </p>
              <p>
                Ne deconnectez pas l'appareil lie depuis WhatsApp sur votre telephone, sinon le bot sera desactive.
              </p>
              <p>
                Le QR Code expire apres quelques minutes. Si la connexion echoue, actualisez la page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
