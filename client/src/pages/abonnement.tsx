import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  CreditCard, 
  Check, 
  Crown,
  Zap,
  Calendar,
  MessageSquare,
  Shield,
  ExternalLink,
  Settings
} from "lucide-react";
import type { ProviderProfile } from "@shared/schema";

const features = [
  { icon: MessageSquare, text: "Bot WhatsApp intelligent" },
  { icon: Calendar, text: "Reservations illimitees" },
  { icon: Zap, text: "Rappels automatiques" },
  { icon: Shield, text: "Acces a la blacklist partagee" },
];

export default function AbonnementPage() {
  const { toast } = useToast();
  const { data: profile, isLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });

  const customerPortalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/customer-portal");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'ouvrir le portail",
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Actif</Badge>;
      case "trial":
        return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Essai gratuit</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Annule</Badge>;
      case "expired":
        return <Badge variant="destructive">Expire</Badge>;
      default:
        return <Badge variant="secondary">Inconnu</Badge>;
    }
  };

  const handleManageSubscription = () => {
    customerPortalMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-abonnement-title">Abonnement</h1>
        <p className="text-muted-foreground">
          Gerez votre abonnement et vos informations de paiement
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Votre abonnement
            </CardTitle>
            <CardDescription>
              Etat actuel de votre abonnement ChatSlot
            </CardDescription>
          </div>
          {isLoading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            getStatusBadge(profile?.subscriptionStatus || "trial")
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-48" />
            </div>
          ) : profile?.subscriptionStatus === "trial" ? (
            <>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-900/50">
                <p className="font-medium text-blue-800 dark:text-blue-200">
                  Periode d'essai gratuite
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Vous beneficiez de 14 jours d'essai gratuit avec acces a toutes les fonctionnalites.
                </p>
              </div>
              <Button size="lg" className="w-full sm:w-auto" data-testid="button-subscribe">
                <CreditCard className="h-4 w-4 mr-2" />
                S'abonner - 29E/mois
              </Button>
            </>
          ) : profile?.subscriptionStatus === "active" ? (
            <>
              <div className="flex items-center gap-6">
                <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Crown className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="text-3xl font-bold">29E<span className="text-lg text-muted-foreground">/mois</span></p>
                  <p className="text-muted-foreground">Plan Professionnel</p>
                </div>
              </div>
              <div className="flex gap-4 flex-wrap">
                <Button 
                  variant="outline" 
                  onClick={handleManageSubscription}
                  disabled={customerPortalMutation.isPending}
                  data-testid="button-manage-subscription"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  {customerPortalMutation.isPending ? "Chargement..." : "GERER_MON_ABONNEMENT"}
                  <ExternalLink className="h-3 w-3 ml-2" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-900/50">
                <p className="font-medium text-red-800 dark:text-red-200">
                  Abonnement expire
                </p>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  Votre abonnement a expire. Renouvelez pour continuer a utiliser ChatSlot.
                </p>
              </div>
              <Button size="lg" className="w-full sm:w-auto" data-testid="button-renew">
                <CreditCard className="h-4 w-4 mr-2" />
                Renouveler - 29E/mois
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fonctionnalites incluses</CardTitle>
          <CardDescription>
            Toutes les fonctionnalites sont incluses dans votre abonnement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <span className="font-medium">{feature.text}</span>
                <Check className="h-5 w-5 text-green-600 ml-auto" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {profile?.stripeCustomerId && (
        <Card className="border-[#39FF14]/30 bg-black/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#39FF14] font-mono text-sm">
              <Settings className="h-4 w-4" />
              STRIPE_CUSTOMER_PORTAL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-400 text-sm mb-4 font-mono">
              Accedez au portail Stripe pour modifier vos informations de paiement, consulter vos factures ou annuler votre abonnement.
            </p>
            <Button 
              variant="outline"
              onClick={handleManageSubscription}
              disabled={customerPortalMutation.isPending}
              className="border-[#39FF14]/50 text-[#39FF14] hover:bg-[#39FF14]/10 font-mono text-xs"
              data-testid="button-stripe-portal"
            >
              <ExternalLink className="h-3 w-3 mr-2" />
              {customerPortalMutation.isPending ? "LOADING..." : "GERER_MON_ABONNEMENT"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Informations de paiement
          </CardTitle>
          <CardDescription>
            Gerez vos moyens de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Aucun moyen de paiement enregistre</p>
            <p className="text-sm mt-1">Ajoutez une carte bancaire pour souscrire a l'abonnement</p>
            <Button variant="outline" className="mt-4" data-testid="button-add-card">
              Ajouter une carte
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
