import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Shield, Lock, Ghost, Users, Globe, MessageSquare } from "lucide-react";
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

function StatCounter({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center p-6 border border-primary/30 rounded-lg bg-black/50 neon-border hover:neon-border-strong transition-all">
      <div className="font-mono text-4xl md:text-5xl font-bold text-primary neon-text-strong mb-2">
        {value}
      </div>
      <div className="text-sm text-muted-foreground font-mono uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="p-6 border border-primary/30 rounded-lg bg-black/50 neon-border hover:neon-border-strong transition-all group">
      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-mono text-lg font-bold text-primary mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function SecurityBadge({ icon: Icon, label, description }: { icon: any; label: string; description: string }) {
  return (
    <div className="flex items-center gap-4 p-4 border border-primary/30 rounded-lg bg-black/50 neon-border">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <div className="font-mono text-sm font-bold text-primary">[{label}]</div>
        <div className="text-xs text-muted-foreground">{description}</div>
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
        <section className="container mx-auto px-4 py-20 md:py-32 text-center">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="space-y-2">
              <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase">
                // {t("landing.systemOnline")}
              </div>
              <h1 className="font-mono text-3xl md:text-5xl lg:text-6xl font-bold leading-tight">
                <span className="text-primary neon-text-strong">{t("landing.heroTitle1")}</span>
                <br />
                <span className="text-muted-foreground">{t("landing.heroTitle2")}</span>
              </h1>
            </div>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t("landing.heroSubtitle")}
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

            <div className="pt-4 font-mono text-xs text-primary/50">
              {">"} {t("landing.encryptedConnection")}
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 border-t border-primary/20">
          <div className="text-center mb-12">
            <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase mb-2">
              // {t("landing.proofOfValue")}
            </div>
            <h2 className="font-mono text-2xl md:text-3xl font-bold text-primary neon-text">
              {t("landing.keyStats")}
            </h2>
          </div>
          
          <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
            <StatCounter value="+12.000" label={t("landing.stat1Label")} />
            <StatCounter value="850+" label={t("landing.stat2Label")} />
            <StatCounter value="0" label={t("landing.stat3Label")} />
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 border-t border-primary/20">
          <div className="text-center mb-12">
            <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase mb-2">
              // {t("landing.secretFeatures")}
            </div>
            <h2 className="font-mono text-2xl md:text-3xl font-bold text-primary neon-text">
              {t("landing.featuresTitle")}
            </h2>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
            <FeatureCard 
              icon={MessageSquare}
              title={t("landing.feature1Title")}
              description={t("landing.feature1Desc")}
            />
            <FeatureCard 
              icon={Lock}
              title={t("landing.feature2Title")}
              description={t("landing.feature2Desc")}
            />
            <FeatureCard 
              icon={Ghost}
              title={t("landing.feature3Title")}
              description={t("landing.feature3Desc")}
            />
            <FeatureCard 
              icon={Shield}
              title={t("landing.feature4Title")}
              description={t("landing.feature4Desc")}
            />
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 border-t border-primary/20">
          <div className="text-center mb-12">
            <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase mb-2">
              // {t("landing.securitySection")}
            </div>
            <h2 className="font-mono text-2xl md:text-3xl font-bold text-primary neon-text">
              {t("landing.privacyTitle")}
            </h2>
          </div>
          
          <div className="grid gap-4 md:grid-cols-3 max-w-4xl mx-auto">
            <SecurityBadge 
              icon={Shield}
              label="ZERO_LOG_POLICY"
              description={t("landing.badge1Desc")}
            />
            <SecurityBadge 
              icon={Lock}
              label="END_TO_END"
              description={t("landing.badge2Desc")}
            />
            <SecurityBadge 
              icon={Globe}
              label="MULTILINGUAL"
              description={t("landing.badge3Desc")}
            />
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 border-t border-primary/20">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="font-mono text-xs text-primary/70 tracking-[0.3em] uppercase">
              // {t("landing.businessCase")}
            </div>
            
            <div className="p-8 border border-primary/30 rounded-lg bg-black/50 neon-border">
              <div className="font-mono text-3xl md:text-4xl font-bold text-primary neon-text mb-4">
                50€<span className="text-lg text-muted-foreground">/{t("common.month")}</span>
              </div>
              <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
                {t("landing.businessDesc")}
              </p>
            </div>

            <Link href="/login">
              <Button 
                size="lg" 
                className="font-mono text-lg px-8 py-6 bg-primary text-black neon-border-strong animate-pulse"
                data-testid="button-access-system-bottom"
              >
                [ {t("landing.accessSystem")} ]
              </Button>
            </Link>
          </div>
        </section>

        <footer className="container mx-auto px-4 py-8 border-t border-primary/20 text-center">
          <div className="font-mono text-xs text-primary/50 space-y-2">
            <p>CHATSLOT v1.0 // "{t("landing.crackTheCode")}"</p>
            <p className="text-muted-foreground">{t("landing.footer")}</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
