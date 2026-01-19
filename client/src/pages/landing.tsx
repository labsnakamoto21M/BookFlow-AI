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
  Terminal
} from "lucide-react";
import { LightningLogo } from "@/components/lightning-logo";

const features = [
  {
    icon: MessageSquare,
    title: "Bot WhatsApp intelligent",
    description: "Répondez automatiquement aux questions sur vos services et tarifs 24h/24.",
  },
  {
    icon: Calendar,
    title: "Réservations automatiques",
    description: "Les clients réservent directement via WhatsApp, sans intervention manuelle.",
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
    description: "Connectez votre WhatsApp en scannant un QR code et configurez vos services.",
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
    content: "Mes clients adorent pouvoir réserver via WhatsApp. Plus besoin de répondre au téléphone !",
  },
  {
    name: "Sophie M.",
    role: "Esthéticienne",
    content: "La blacklist partagée m'a évité plusieurs mauvaises expériences. Indispensable !",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background relative">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md border-b border-primary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <div className="flex items-center gap-3">
              <LightningLogo size="sm" />
              <span className="font-bold text-xl text-primary neon-text font-mono">ChatSlot</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <a href="#features" className="text-muted-foreground hover:text-primary transition-colors font-mono text-sm">
                [Fonctionnalités]
              </a>
              <a href="#testimonials" className="text-muted-foreground hover:text-primary transition-colors font-mono text-sm">
                [Témoignages]
              </a>
              <a href="#pricing" className="text-muted-foreground hover:text-primary transition-colors font-mono text-sm">
                [Tarifs]
              </a>
            </div>
            <Button asChild data-testid="button-login" className="neon-border font-mono">
              <a href="/api/login">
                Accéder au système
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
              {/* Terminal-style status indicator */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-black border border-primary/50 neon-border">
                <Terminal className="h-4 w-4 text-primary" />
                <span className="font-mono text-sm text-primary terminal-cursor">System Terminal Online</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
                <span className="text-foreground">Automatisez vos</span>{" "}
                <span className="text-primary neon-text-strong">réservations</span>{" "}
                <span className="text-foreground">via WhatsApp</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl font-mono">
                {">"} L'assistant intelligent qui gère vos rendez-vous, répond à vos clients et vous protège 
                des no-shows. Concentrez-vous sur votre métier.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild data-testid="button-get-started" className="neon-border-strong font-mono">
                  <a href="/api/login">
                    {">"} Initialiser le système
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" data-testid="button-demo" className="font-mono">
                  Voir une démo
                </Button>
              </div>
              <div className="flex items-center gap-6 pt-4 text-sm text-muted-foreground font-mono">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>[Sans carte bancaire]</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-primary" />
                  <span>[Config: 5 min]</span>
                </div>
              </div>
            </div>
            <div className="relative lg:pl-8">
              <div className="relative rounded-sm overflow-hidden border border-primary/30 neon-border bg-black p-8 aspect-square flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
                <div className="relative z-10 bg-card rounded-sm border border-primary/30 p-6 w-full max-w-sm space-y-4">
                  <div className="flex items-center gap-3">
                    <LightningLogo size="sm" />
                    <div>
                      <p className="font-mono font-medium text-sm text-primary">ChatSlot_Bot</p>
                      <p className="text-xs text-muted-foreground font-mono">status: online</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="bg-muted/50 border border-primary/20 rounded-sm p-3 text-sm max-w-[80%] font-mono">
                      {">"} Réservation coupe demain
                    </div>
                    <div className="bg-primary/20 border border-primary/40 text-primary-foreground rounded-sm p-3 text-sm max-w-[85%] ml-auto font-mono">
                      <span className="text-primary">{"<"} Créneaux dispo:</span> 10h, 11h30, 14h, 16h
                    </div>
                    <div className="bg-muted/50 border border-primary/20 rounded-sm p-3 text-sm max-w-[60%] font-mono">
                      {">"} 14h
                    </div>
                    <div className="bg-primary/20 border border-primary/40 text-primary-foreground rounded-sm p-3 text-sm max-w-[90%] ml-auto font-mono">
                      <span className="text-primary">{"<"} CONFIRMED:</span> RDV demain 14h. Rappel 1h avant.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/10 border-y border-primary/20">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 font-mono">
              <span className="text-primary">{"// "}</span>Modules disponibles
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto font-mono">
              Une solution complète pour automatiser vos réservations et améliorer votre relation client.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="hover-elevate bg-card border border-primary/20 rounded-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="h-12 w-12 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center neon-border">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold font-mono text-primary">{feature.title}</h3>
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
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 font-mono">
              <span className="text-primary">{"// "}</span>Témoignages utilisateurs
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto font-mono">
              Découvrez comment ChatSlot transforme le quotidien des prestataires de services.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="bg-card border border-primary/20 rounded-sm">
                <CardContent className="p-6 space-y-4">
                  <p className="text-muted-foreground italic font-mono text-sm">"{testimonial.content}"</p>
                  <div className="flex items-center gap-3 pt-2">
                    <div className="h-10 w-10 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center font-mono font-semibold text-primary">
                      {testimonial.name[0]}
                    </div>
                    <div>
                      <p className="font-medium text-sm font-mono text-primary">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/10 border-y border-primary/20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 font-mono">
              <span className="text-primary">{"// "}</span>Tarification
            </h2>
            <p className="text-lg text-muted-foreground font-mono">
              Un seul plan qui inclut toutes les fonctionnalités.
            </p>
          </div>
          <Card className="border-2 border-primary neon-border-strong bg-card rounded-sm">
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold font-mono text-primary">Professionnel</h3>
                  <p className="text-muted-foreground font-mono">Toutes les fonctionnalités incluses</p>
                </div>
                <div className="text-center md:text-right">
                  <div className="flex items-baseline gap-1 justify-center md:justify-end">
                    <span className="text-4xl font-bold text-primary neon-text font-mono">29€</span>
                    <span className="text-muted-foreground font-mono">/mois</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 font-mono">[14 jours d'essai gratuit]</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-8 mb-8">
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Bot WhatsApp intelligent</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Réservations illimitées</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Rappels automatiques</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Blacklist partagée</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Gestion des services</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-sm">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span>Support prioritaire</span>
                </div>
              </div>
              <Button size="lg" className="w-full neon-border-strong font-mono" asChild data-testid="button-subscribe">
                <a href="/api/login">
                  {">"} Activer la licence d'essai
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-primary/20">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <LightningLogo size="sm" />
              <span className="font-mono font-semibold text-primary">ChatSlot</span>
            </div>
            <p className="text-sm text-primary font-mono neon-text text-center">
              "Brisez le plafond. Automatisez le business."
            </p>
            <p className="text-sm text-muted-foreground font-mono">
              © {new Date().getFullYear()} ChatSlot. Tous droits réservés.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
