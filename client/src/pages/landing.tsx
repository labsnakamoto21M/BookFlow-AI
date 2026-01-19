import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Calendar, 
  MessageSquare, 
  Clock, 
  Shield, 
  Zap, 
  CheckCircle,
  ArrowRight,
  Send
} from "lucide-react";
const features = [
  {
    icon: MessageSquare,
    title: "Assistant intelligent",
    description: "Répondez automatiquement aux questions sur vos services et tarifs 24h/24.",
  },
  {
    icon: Calendar,
    title: "Réservations conversationnelles",
    description: "Les clients réservent via une discussion naturelle, comme avec un ami.",
  },
  {
    icon: Clock,
    title: "Rappels automatiques",
    description: "Envoyez des confirmations 1h avant chaque rendez-vous pour réduire les no-shows.",
  },
  {
    icon: Shield,
    title: "Blacklist partagée",
    description: "Protection collective contre les clients problématiques entre prestataires.",
  },
  {
    icon: Zap,
    title: "Configuration simple",
    description: "Configurez vos services et connectez-vous en quelques minutes.",
  },
  {
    icon: CheckCircle,
    title: "Agenda centralisé",
    description: "Visualisez tous vos rendez-vous et bloquez des créneaux en un clic.",
  },
];

const testimonials = [
  {
    name: "Marie D.",
    role: "Coiffeuse",
    content: "J'ai réduit mes no-shows de 80% grâce aux rappels automatiques. Un gain de temps incroyable !",
  },
  {
    name: "Thomas L.",
    role: "Barbier",
    content: "Mes clients adorent pouvoir réserver facilement. Plus besoin de répondre au téléphone !",
  },
  {
    name: "Sophie M.",
    role: "Esthéticienne",
    content: "La blacklist partagée m'a évité plusieurs mauvaises expériences. Indispensable !",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground relative">
                <MessageSquare className="h-4 w-4 absolute top-1 left-1.5" />
                <Clock className="h-4 w-4 absolute bottom-1 right-1.5" />
              </div>
              <span className="font-bold text-xl">ChatSlot</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                Fonctionnalités
              </a>
              <a href="#testimonials" className="text-muted-foreground hover:text-foreground transition-colors">
                Témoignages
              </a>
              <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                Tarifs
              </a>
            </div>
            <Button asChild data-testid="button-login">
              <a href="/api/login">
                Se connecter
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-sm font-medium">
                <Zap className="h-4 w-4" />
                Essai gratuit de 14 jours
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
                Vos{" "}
                <span className="text-primary">réservations</span>{" "}
                en mode chat
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl">
                L'assistant conversationnel qui gère vos rendez-vous comme une discussion. 
                Vos clients réservent naturellement, vous gérez tout depuis une interface familière.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild data-testid="button-get-started">
                  <a href="/api/login">
                    Commencer gratuitement
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" data-testid="button-demo">
                  Voir une démo
                </Button>
              </div>
              <div className="flex items-center gap-6 pt-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Sans carte bancaire
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  Configuration en 5 min
                </div>
              </div>
            </div>
            <div className="relative lg:pl-8">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-8 aspect-square flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent" />
                <div className="relative z-10 bg-card rounded-2xl shadow-lg w-full max-w-sm overflow-hidden">
                  <div className="bg-primary px-4 py-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center relative">
                      <MessageSquare className="h-4 w-4 text-white absolute top-1.5 left-1.5" />
                      <Clock className="h-4 w-4 text-white absolute bottom-1.5 right-1.5" />
                    </div>
                    <div className="text-white">
                      <p className="font-semibold text-sm">ChatSlot</p>
                      <p className="text-xs text-white/80">En ligne</p>
                    </div>
                  </div>
                  <div className="p-4 space-y-3 bg-gradient-to-b from-accent/30 to-accent/10">
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 text-sm max-w-[85%] shadow-sm">
                      Bonjour ! Je voudrais réserver une coupe demain.
                    </div>
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm p-3 text-sm max-w-[90%] ml-auto shadow-sm">
                      Bien sûr ! Voici les créneaux disponibles demain : 10h, 11h30, 14h, 16h. Lequel vous convient ?
                    </div>
                    <div className="bg-white rounded-2xl rounded-tl-sm p-3 text-sm max-w-[60%] shadow-sm">
                      14h parfait !
                    </div>
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm p-3 text-sm max-w-[95%] ml-auto shadow-sm">
                      Parfait ! Votre RDV est confirmé pour demain à 14h. Vous recevrez un rappel 1h avant.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Une solution complète pour automatiser vos réservations et améliorer votre relation client.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="hover-elevate border-0 shadow-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Ils nous font confiance
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Découvrez comment ChatSlot transforme le quotidien des prestataires de services.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-0 shadow-sm">
                <CardContent className="p-6 space-y-4">
                  <p className="text-muted-foreground italic">"{testimonial.content}"</p>
                  <div className="flex items-center gap-3 pt-2">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                      {testimonial.name[0]}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Tarif simple et transparent
            </h2>
            <p className="text-lg text-muted-foreground">
              Un seul plan qui inclut toutes les fonctionnalités.
            </p>
          </div>
          <Card className="border-2 border-primary shadow-lg">
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold">Professionnel</h3>
                  <p className="text-muted-foreground">Toutes les fonctionnalités incluses</p>
                </div>
                <div className="text-center md:text-right">
                  <div className="flex items-baseline gap-1 justify-center md:justify-end">
                    <span className="text-4xl font-bold">29€</span>
                    <span className="text-muted-foreground">/mois</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">14 jours d'essai gratuit</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-8 mb-8">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Assistant intelligent</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Réservations illimitées</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Rappels automatiques</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Blacklist partagée</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Gestion des services</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Support prioritaire</span>
                </div>
              </div>
              <Button size="lg" className="w-full" asChild data-testid="button-subscribe">
                <a href="/api/login">
                  Commencer l'essai gratuit
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground relative">
                <MessageSquare className="h-3 w-3 absolute top-1 left-1.5" />
                <Clock className="h-3 w-3 absolute bottom-1 right-1.5" />
              </div>
              <span className="font-semibold">ChatSlot</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} ChatSlot. Tous droits réservés.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
