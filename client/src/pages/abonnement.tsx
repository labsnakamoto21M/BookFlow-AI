import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CreditCard, 
  Check, 
  Crown,
  Zap,
  Calendar,
  MessageSquare,
  Shield
} from "lucide-react";
import type { ProviderProfile } from "@shared/schema";

const features = [
  { icon: MessageSquare, text: "Bot WhatsApp intelligent" },
  { icon: Calendar, text: "Réservations illimitées" },
  { icon: Zap, text: "Rappels automatiques" },
  { icon: Shield, text: "Accès à la blacklist partagée" },
];

export default function AbonnementPage() {
  const { data: profile, isLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Actif</Badge>;
      case "trial":
        return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Essai gratuit</Badge>;
      case "expired":
        return <Badge variant="destructive">Expiré</Badge>;
      default:
        return <Badge variant="secondary">Inconnu</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-abonnement-title">Abonnement</h1>
        <p className="text-muted-foreground">
          Gérez votre abonnement et vos informations de paiement
        </p>
      </div>

      {/* Current Plan */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Votre abonnement
            </CardTitle>
            <CardDescription>
              État actuel de votre abonnement WhatsBook
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
                  Période d'essai gratuite
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Vous bénéficiez de 14 jours d'essai gratuit avec accès à toutes les fonctionnalités.
                </p>
              </div>
              <Button size="lg" className="w-full sm:w-auto" data-testid="button-subscribe">
                <CreditCard className="h-4 w-4 mr-2" />
                S'abonner - 29€/mois
              </Button>
            </>
          ) : profile?.subscriptionStatus === "active" ? (
            <>
              <div className="flex items-center gap-6">
                <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Crown className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="text-3xl font-bold">29€<span className="text-lg text-muted-foreground">/mois</span></p>
                  <p className="text-muted-foreground">Plan Professionnel</p>
                </div>
              </div>
              <div className="flex gap-4 flex-wrap">
                <Button variant="outline" data-testid="button-manage-subscription">
                  Gérer l'abonnement
                </Button>
                <Button variant="ghost" className="text-destructive hover:text-destructive">
                  Annuler l'abonnement
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-900/50">
                <p className="font-medium text-red-800 dark:text-red-200">
                  Abonnement expiré
                </p>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  Votre abonnement a expiré. Renouvelez pour continuer à utiliser WhatsBook.
                </p>
              </div>
              <Button size="lg" className="w-full sm:w-auto" data-testid="button-renew">
                <CreditCard className="h-4 w-4 mr-2" />
                Renouveler - 29€/mois
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Fonctionnalités incluses</CardTitle>
          <CardDescription>
            Toutes les fonctionnalités sont incluses dans votre abonnement
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

      {/* Payment Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Informations de paiement
          </CardTitle>
          <CardDescription>
            Gérez vos moyens de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Aucun moyen de paiement enregistré</p>
            <p className="text-sm mt-1">Ajoutez une carte bancaire pour souscrire à l'abonnement</p>
            <Button variant="outline" className="mt-4" data-testid="button-add-card">
              Ajouter une carte
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
