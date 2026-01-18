import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  AlertTriangle
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";

interface WhatsAppStatus {
  connected: boolean;
  qrCode?: string;
  phoneNumber?: string;
  lastSeen?: string;
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const [pollingEnabled, setPollingEnabled] = useState(true);

  const { data: status, isLoading, refetch } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: pollingEnabled ? 3000 : false,
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
      toast({ title: "Succès", description: "WhatsApp déconnecté" });
      setPollingEnabled(true);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de déconnecter WhatsApp", variant: "destructive" });
    },
  });

  const refreshQRMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/refresh-qr"),
    onSuccess: () => {
      refetch();
      toast({ title: "Succès", description: "QR Code actualisé" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'actualiser le QR Code", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-whatsapp-title">Connexion WhatsApp</h1>
          <p className="text-muted-foreground">
            Connectez votre compte WhatsApp pour activer le bot
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : status?.connected ? (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <Wifi className="h-3 w-3 mr-1" />
              Connecté
            </Badge>
          ) : (
            <Badge variant="secondary">
              <WifiOff className="h-3 w-3 mr-1" />
              Déconnecté
            </Badge>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* QR Code / Connected Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SiWhatsapp className="h-5 w-5 text-primary" />
              État de la connexion
            </CardTitle>
            <CardDescription>
              {status?.connected 
                ? "Votre WhatsApp est connecté et le bot est actif"
                : "Scannez le QR Code avec WhatsApp pour connecter votre compte"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center py-8">
            {isLoading ? (
              <Skeleton className="h-64 w-64" />
            ) : status?.connected ? (
              <div className="text-center space-y-6">
                <div className="h-32 w-32 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="h-16 w-16 text-green-600" />
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-lg">WhatsApp connecté</p>
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
                  {disconnectMutation.isPending ? "Déconnexion..." : "Déconnecter"}
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
                    Ouvrez WhatsApp sur votre téléphone, allez dans Paramètres → Appareils liés → Lier un appareil
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
                <div className="h-32 w-32 mx-auto rounded-full bg-muted flex items-center justify-center">
                  <QrCode className="h-16 w-16 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <p className="font-medium">Chargement du QR Code...</p>
                  <p className="text-sm text-muted-foreground">
                    Le QR Code apparaîtra dans quelques instants
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => refetch()}
                  data-testid="button-retry"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Réessayer
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Instructions */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Comment ça fonctionne ?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  1
                </div>
                <div>
                  <p className="font-medium">Scannez le QR Code</p>
                  <p className="text-sm text-muted-foreground">
                    Utilisez l'application WhatsApp de votre téléphone pour scanner le code
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  2
                </div>
                <div>
                  <p className="font-medium">Gardez votre téléphone connecté</p>
                  <p className="text-sm text-muted-foreground">
                    WhatsApp Web nécessite que votre téléphone soit en ligne
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  3
                </div>
                <div>
                  <p className="font-medium">Le bot est prêt !</p>
                  <p className="text-sm text-muted-foreground">
                    Le bot répondra automatiquement aux messages de vos clients
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10">
            <CardContent className="p-6">
              <div className="flex gap-4">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-amber-800 dark:text-amber-200">Important</p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Utilisez un numéro WhatsApp dédié à votre activité professionnelle. 
                    Le bot répondra à tous les messages reçus sur ce numéro.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
