import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Shield, Lock, Globe, Hand, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LightningLogo } from "@/components/lightning-logo";

const LANGUAGES = [
  { code: "fr", label: "FR" },
  { code: "nl", label: "NL" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
  { code: "ro", label: "RO" },
  { code: "pt", label: "PT" },
  { code: "de", label: "DE" },
  { code: "sq", label: "SQ" },
  { code: "hu", label: "HU" },
  { code: "it", label: "IT" },
  { code: "zh", label: "ZH" },
] as const;

const PLANS = [
  { name: "SOLO", price: 59, slots: 1 },
  { name: "DUO", price: 99, slots: 2 },
  { name: "TRIO", price: 129, slots: 3 },
  { name: "HEXA", price: 199, slots: 6 },
  { name: "AGENCY", price: 299, slots: 15 },
] as const;

function LanguageSelector() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.substring(0, 2) || "fr";

  const changeLanguage = (langCode: string) => {
    i18n.changeLanguage(langCode);
    localStorage.setItem("chatslot-language", langCode);
  };

  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => changeLanguage(code)}
          className={`font-mono text-xs px-1.5 py-0.5 rounded-sm transition-all ${
            currentLang === code
              ? "bg-primary/20 text-primary neon-text border border-primary/50"
              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
          }`}
          data-testid={`button-lang-${code}`}
        >
          [{label}]
        </button>
      ))}
    </div>
  );
}

function WhatsAppMockup() {
  const { t } = useTranslation();
  
  const messages = [
    { from: "client", text: "Cc dispo 1h ?" },
    { from: "bot", text: "cc! oui 100e. 20h ou 21h?" },
    { from: "client", text: "20h c bon" },
    { from: "bot", text: "ok c noter. je suis rue [X]. je tenvoie le num 15min avant. a tte" },
  ];

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="bg-zinc-900 rounded-lg border border-primary/30 overflow-hidden">
        <div className="bg-zinc-800 px-4 py-2 flex items-center gap-3 border-b border-primary/20">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-primary font-mono text-xs">BOT</span>
          </div>
          <div>
            <div className="font-mono text-xs text-primary">{t("landing.whatsappDemo")}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{t("landing.autoReply")}</div>
          </div>
        </div>
        
        <div className="p-4 space-y-3 min-h-[280px]">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.from === "client" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg font-mono text-sm ${
                  msg.from === "client"
                    ? "bg-primary/20 text-primary"
                    : "bg-zinc-800 text-muted-foreground border border-primary/20"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OnboardingSteps() {
  const { t } = useTranslation();
  
  const steps = [
    { num: "1", text: t("landing.step1") },
    { num: "2", text: t("landing.step2") },
    { num: "3", text: t("landing.step3") },
  ];

  return (
    <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary flex items-center justify-center">
            <span className="font-mono text-lg font-bold text-primary">{step.num}</span>
          </div>
          <span className="font-mono text-sm text-muted-foreground">{step.text}</span>
          {idx < steps.length - 1 && (
            <span className="hidden md:block font-mono text-primary mx-2">{">"}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function TrustBadge({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border border-primary/30 rounded-md bg-black/50">
      <Icon className="h-4 w-4 text-primary" />
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function PricingCard({ name, price, slots, isPopular }: { name: string; price: number; slots: number; isPopular?: boolean }) {
  const { t } = useTranslation();
  
  return (
    <div className={`p-6 border rounded-lg bg-black/50 relative ${
      isPopular ? "border-primary neon-border-strong" : "border-primary/30 neon-border"
    }`}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-black font-mono text-xs rounded-full">
          {t("landing.popular")}
        </div>
      )}
      <div className="text-center">
        <div className="font-mono text-xl font-bold text-primary mb-2">{name}</div>
        <div className="font-mono text-3xl font-bold text-foreground mb-1">
          {price}<span className="text-lg text-muted-foreground">/{t("common.month")}</span>
        </div>
        <div className="font-mono text-sm text-muted-foreground mb-4">
          {slots} {slots > 1 ? t("landing.slots") : t("landing.slot")}
        </div>
        <Link href="/login">
          <Button 
            variant={isPopular ? "default" : "outline"} 
            size="sm" 
            className="w-full font-mono"
            data-testid={`button-plan-${name.toLowerCase()}`}
          >
            {t("landing.selectPlan")}
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-black text-foreground">
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur border-b border-primary/20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LightningLogo size="sm" />
            <span className="font-mono font-bold text-primary neon-text">CHATSLOT</span>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSelector />
            <Link href="/login">
              <Button variant="outline" size="sm" className="font-mono border-primary/50 text-primary" data-testid="button-header-login">
                {t("auth.login")}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-20">
        <section className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase">
                // {t("landing.systemOnline")}
              </div>
              <h1 className="font-mono text-3xl md:text-4xl lg:text-5xl font-bold leading-tight">
                <span className="text-primary neon-text-strong">{t("landing.heroTitle1")}</span>
              </h1>
              <p className="font-mono text-muted-foreground leading-relaxed">
                {t("landing.heroDesc")}
              </p>
              
              <div className="pt-4">
                <Link href="/login">
                  <Button 
                    size="lg" 
                    className="font-mono text-lg px-8 py-6 bg-primary text-black neon-border-strong animate-pulse"
                    data-testid="button-access-system"
                  >
                    [ {t("landing.accessSystem")} ]
                  </Button>
                </Link>
              </div>
            </div>
            
            <WhatsAppMockup />
          </div>
        </section>

        <section className="container mx-auto px-4 py-12 border-t border-primary/20">
          <div className="text-center mb-8">
            <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase mb-2">
              // {t("landing.howItWorks")}
            </div>
          </div>
          <OnboardingSteps />
        </section>

        <section className="container mx-auto px-4 py-12 border-t border-primary/20">
          <div className="flex flex-wrap gap-3 justify-center">
            <TrustBadge icon={Globe} label={t("landing.badge11Lang")} />
            <TrustBadge icon={Shield} label={t("landing.badgeZeroStorage")} />
            <TrustBadge icon={Lock} label={t("landing.badgeSafetyBlacklist")} />
            <TrustBadge icon={Hand} label={t("landing.badgeManualControl")} />
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 border-t border-primary/20">
          <div className="text-center mb-12">
            <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase mb-2">
              // {t("landing.pricing")}
            </div>
            <h2 className="font-mono text-2xl md:text-3xl font-bold text-primary neon-text">
              {t("landing.choosePlan")}
            </h2>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 max-w-6xl mx-auto">
            {PLANS.map((plan) => (
              <PricingCard
                key={plan.name}
                name={plan.name}
                price={plan.price}
                slots={plan.slots}
                isPopular={plan.name === "TRIO"}
              />
            ))}
          </div>
        </section>

        <footer className="container mx-auto px-4 py-8 border-t border-primary/20 text-center">
          <div className="font-mono text-xs text-primary/50 space-y-2">
            <p>CHATSLOT v2.0 // "{t("landing.crackTheCode")}"</p>
            <p className="text-muted-foreground">{t("landing.footer")}</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
