import { useState, useEffect } from "react";
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
  Settings,
  Loader2,
  Smartphone
} from "lucide-react";

interface ProfileWithPlan {
  id: string;
  userId: string;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  maxSlots: number | null;
  subscriptionPlan: string;
  [key: string]: any;
}

interface StripePlan {
  id: string;
  name: string;
  price: number;
  slots: number;
  available: boolean;
}

const features = [
  { icon: MessageSquare, text: "Bot WhatsApp intelligent" },
  { icon: Calendar, text: "Reservations illimitees" },
  { icon: Zap, text: "Rappels automatiques" },
  { icon: Shield, text: "Acces a la blacklist partagee" },
];

export default function AbonnementPage() {
  const { toast } = useToast();
  const search = window.location.search;
  const [selectedPlan, setSelectedPlan] = useState<string>("solo");
  
  const { data: profile, isLoading, refetch } = useQuery<ProfileWithPlan>({
    queryKey: ["/api/provider/profile"],
  });

  const { data: plans, isLoading: plansLoading } = useQuery<StripePlan[]>({
    queryKey: ["/api/stripe/plans"],
  });

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('success') === 'true') {
      toast({
        title: "Paiement reussi!",
        description: "Votre abonnement est maintenant actif. Bienvenue!",
      });
      refetch();
      window.history.replaceState({}, '', '/abonnement');
    } else if (params.get('cancelled') === 'true') {
      toast({
        title: "Paiement annule",
        description: "Vous pouvez reessayer quand vous le souhaitez.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', '/abonnement');
    } else if (params.get('error')) {
      toast({
        title: "Erreur",
        description: "Une erreur est survenue lors du paiement.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', '/abonnement');
    }
  }, [search, toast, refetch]);

  const checkoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await apiRequest("POST", "/api/stripe/create-checkout-session", { plan });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, '_blank');
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible de creer la session de paiement",
        variant: "destructive",
      });
    },
  });

  const customerPortalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/customer-portal");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, '_blank');
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Erreur portail Stripe - verifiez dashboard activation",
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge data-testid="badge-status-active" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Actif</Badge>;
      case "trial":
        return <Badge data-testid="badge-status-trial" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Essai gratuit</Badge>;
      case "cancelled":
        return <Badge data-testid="badge-status-cancelled" variant="destructive">Annule</Badge>;
      case "expired":
        return <Badge data-testid="badge-status-expired" variant="destructive">Expire</Badge>;
      default:
        return <Badge data-testid="badge-status-unknown" variant="secondary">Inconnu</Badge>;
    }
  };

  const currentPlan = profile?.subscriptionPlan || 'solo';
  const isActive = profile?.subscriptionStatus === 'active';

  const handleSubscribe = (plan: string) => {
    checkoutMutation.mutate(plan);
  };

  const handleManageSubscription = () => {
    customerPortalMutation.mutate();
  };

  const renderPlanCards = () => {
    if (plansLoading) {
      return (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      );
    }

    if (!plans || plans.length === 0) {
      return (
        <p className="text-muted-foreground text-center py-8">
          Aucun plan disponible pour le moment.
        </p>
      );
    }

    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.filter(p => p.available).map((plan) => {
          const isCurrentPlan = isActive && plan.id === currentPlan;
          const isSelected = !isActive && plan.id === selectedPlan;
          const isUpgrade = isActive && plans.findIndex(p => p.id === plan.id) > plans.findIndex(p => p.id === currentPlan);

          return (
            <Card
              key={plan.id}
              className={`relative cursor-pointer transition-colors ${
                isCurrentPlan
                  ? "border-[#39FF14] bg-[#39FF14]/5"
                  : isSelected
                    ? "border-[#39FF14] bg-[#39FF14]/5"
                    : "hover-elevate"
              }`}
              onClick={() => {
                if (!isActive) setSelectedPlan(plan.id);
              }}
              data-testid={`card-plan-${plan.id}`}
            >
              {isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-[#39FF14] text-black font-mono text-xs">
                    PLAN ACTUEL
                  </Badge>
                </div>
              )}
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm" data-testid={`text-plan-name-${plan.id}`}>{plan.name}</span>
                </CardTitle>
                <div className="flex items-baseline gap-1 pt-2">
                  <span className="text-3xl font-bold" data-testid={`text-plan-price-${plan.id}`}>{plan.price}</span>
                  <span className="text-muted-foreground text-sm">/mois</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm" data-testid={`text-plan-slots-${plan.id}`}>
                  <Smartphone className="h-4 w-4 text-[#39FF14]" />
                  <span>{plan.slots} numero{plan.slots > 1 ? "s" : ""} WhatsApp</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-[#39FF14]" />
                  <span>Reservations illimitees</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Zap className="h-4 w-4 text-[#39FF14]" />
                  <span>Bot IA 24/7</span>
                </div>

                {!isActive ? (
                  <Button
                    className={`w-full font-mono ${
                      isSelected
                        ? "bg-[#39FF14] text-black"
                        : ""
                    }`}
                    variant={isSelected ? "default" : "outline"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPlan(plan.id);
                      handleSubscribe(plan.id);
                    }}
                    disabled={checkoutMutation.isPending}
                    data-testid={`button-subscribe-${plan.id}`}
                  >
                    {checkoutMutation.isPending && selectedPlan === plan.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="h-4 w-4 mr-2" />
                    )}
                    {checkoutMutation.isPending && selectedPlan === plan.id
                      ? "Redirection..."
                      : `S'abonner - ${plan.price}E`}
                  </Button>
                ) : isCurrentPlan ? (
                  <Button
                    variant="outline"
                    className="w-full font-mono border-[#39FF14]/50 text-[#39FF14]"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleManageSubscription();
                    }}
                    disabled={customerPortalMutation.isPending}
                    data-testid="button-manage-current-plan"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    {customerPortalMutation.isPending ? "Chargement..." : "Gerer"}
                  </Button>
                ) : isUpgrade ? (
                  <Button
                    variant="outline"
                    className="w-full font-mono"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleManageSubscription();
                    }}
                    disabled={customerPortalMutation.isPending}
                    data-testid={`button-upgrade-${plan.id}`}
                  >
                    <Crown className="h-4 w-4 mr-2" />
                    {customerPortalMutation.isPending ? "Chargement..." : "Upgrader"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-abonnement-title">Abonnement</h1>
          <p className="text-muted-foreground">
            Choisissez le plan adapte a votre activite
          </p>
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          getStatusBadge(profile?.subscriptionStatus || "trial")
        )}
      </div>

      {isActive && (
        <Card className="border-[#39FF14]/30">
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-[#39FF14]" />
                <span className="font-mono">Abonnement actif</span>
              </CardTitle>
              <CardDescription>
                Plan {currentPlan.toUpperCase()} - {profile?.maxSlots || 1} slot{(profile?.maxSlots || 1) > 1 ? "s" : ""}
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={handleManageSubscription}
                disabled={customerPortalMutation.isPending}
                data-testid="button-manage-subscription"
              >
                <Settings className="h-4 w-4 mr-2" />
                {customerPortalMutation.isPending ? "Chargement..." : "Gerer mon abonnement"}
                <ExternalLink className="h-3 w-3 ml-2" />
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {!isActive && profile?.subscriptionStatus === "trial" && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-blue-800 dark:text-blue-200">
                  Periode d'essai gratuite
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Vous beneficiez de 14 jours d'essai gratuit. Choisissez un plan ci-dessous pour continuer apres la periode d'essai.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {profile?.subscriptionStatus === "cancelled" || profile?.subscriptionStatus === "expired" ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-red-800 dark:text-red-200">
                  Abonnement {profile?.subscriptionStatus === "cancelled" ? "annule" : "expire"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Choisissez un plan ci-dessous pour reactiver votre compte.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div>
        <h2 className="text-lg font-bold mb-4 font-mono" data-testid="text-plans-heading">
          {isActive ? "Changer de plan" : "Choisissez votre plan"}
        </h2>
        {renderPlanCards()}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Toutes les fonctionnalites incluses</CardTitle>
          <CardDescription>
            Quel que soit le plan, vous avez acces a toutes les fonctionnalites
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid={`text-feature-${index}`}>
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
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
              className="border-[#39FF14]/50 text-[#39FF14] font-mono text-xs"
              data-testid="button-stripe-portal"
            >
              <ExternalLink className="h-3 w-3 mr-2" />
              {customerPortalMutation.isPending ? "LOADING..." : "OUVRIR_PORTAIL_STRIPE"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
