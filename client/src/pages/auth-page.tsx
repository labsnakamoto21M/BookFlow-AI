import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, User, Eye, EyeOff, Zap, Shield, Copy, CheckCircle, AlertTriangle } from "lucide-react";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [copiedPhrase, setCopiedPhrase] = useState(false);
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Erreur de connexion");
      }
      return res.json();
    },
    onSuccess: (data) => {
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setLocation("/");
      window.location.reload();
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { email: string; password: string; firstName?: string; lastName?: string }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Erreur d'inscription");
      }
      return res.json();
    },
    onSuccess: (data) => {
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      if (data.recoveryPhrase) {
        setRecoveryPhrase(data.recoveryPhrase);
      } else {
        setLocation("/");
        window.location.reload();
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ email, password, firstName: firstName || undefined, lastName: lastName || undefined });
    }
  };

  const handleCopyPhrase = async () => {
    if (recoveryPhrase) {
      await navigator.clipboard.writeText(recoveryPhrase);
      setCopiedPhrase(true);
      toast({
        title: "Copie",
        description: "Phrase de recuperation copiee",
      });
      setTimeout(() => setCopiedPhrase(false), 3000);
    }
  };

  const handleContinueAfterRecovery = () => {
    setLocation("/");
    window.location.reload();
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

  if (recoveryPhrase) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#39FF14]/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#39FF14]/5 rounded-full blur-3xl" />
        </div>
        
        <Card className="w-full max-w-lg bg-black/95 border-[#39FF14]/50 backdrop-blur-xl relative z-10">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-[#39FF14]/20 flex items-center justify-center border border-[#39FF14]/50 animate-pulse">
                <Shield className="w-8 h-8 text-[#39FF14]" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-[#39FF14] tracking-wider font-mono">
              PHRASE DE RECUPERATION
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="bg-red-500/10 border border-red-500/50 rounded-md p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-400 font-mono">
                <p className="font-bold mb-1">ATTENTION - NOTEZ CETTE PHRASE</p>
                <p>C'est le seul moyen de recuperer votre compte si vous perdez votre mot de passe. Elle ne sera plus jamais affichee.</p>
              </div>
            </div>

            <div className="bg-black border-2 border-[#39FF14]/60 rounded-md p-1 relative overflow-hidden">
              <div className="bg-[#39FF14]/10 border-b border-[#39FF14]/30 px-3 py-2 flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500/70" />
                  <div className="w-2 h-2 rounded-full bg-yellow-500/70" />
                  <div className="w-2 h-2 rounded-full bg-green-500/70" />
                </div>
                <span className="text-[#39FF14]/70 text-xs font-mono ml-2">SECURE_TERMINAL.exe</span>
              </div>
              
              <div className="p-4 font-mono">
                <div className="text-[#39FF14]/60 text-xs mb-2">&gt; GENERATING_RECOVERY_KEY...</div>
                <div className="text-[#39FF14]/60 text-xs mb-3">&gt; ENCRYPTION: AES-256-GCM</div>
                
                <div className="grid grid-cols-3 gap-2 mb-4" data-testid="recovery-phrase-grid">
                  {recoveryPhrase.split(" ").map((word, index) => (
                    <div
                      key={index}
                      className="bg-[#39FF14]/5 border border-[#39FF14]/30 rounded px-2 py-1.5 text-center"
                    >
                      <span className="text-[#39FF14]/50 text-xs mr-1">{index + 1}.</span>
                      <span className="text-[#39FF14] font-bold text-sm">{word}</span>
                    </div>
                  ))}
                </div>
                
                <div className="text-[#39FF14]/60 text-xs animate-pulse">&gt; KEY_GENERATED_SUCCESSFULLY_</div>
              </div>
            </div>

            <Button
              onClick={handleCopyPhrase}
              variant="outline"
              className="w-full border-[#39FF14]/50 text-[#39FF14] hover:bg-[#39FF14]/10 font-mono"
              data-testid="button-copy-phrase"
            >
              {copiedPhrase ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  PHRASE COPIEE
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  COPIER LA PHRASE
                </>
              )}
            </Button>

            <Button
              onClick={handleContinueAfterRecovery}
              className="w-full bg-[#39FF14] hover:bg-[#39FF14]/80 text-black font-bold tracking-wider"
              data-testid="button-continue-after-recovery"
            >
              J'AI NOTE MA PHRASE - CONTINUER
            </Button>
            
            <p className="text-center text-xs text-gray-500 font-mono">
              STOCKEZ CETTE PHRASE DANS UN ENDROIT SECURISE
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#39FF14]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#39FF14]/5 rounded-full blur-3xl" />
      </div>
      
      <Card className="w-full max-w-md bg-black/90 border-[#39FF14]/30 backdrop-blur-xl relative z-10">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-[#39FF14]/20 flex items-center justify-center border border-[#39FF14]/50">
              <Zap className="w-8 h-8 text-[#39FF14]" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold text-[#39FF14] tracking-wider">
            CHATSLOT
          </CardTitle>
          <p className="text-gray-400 text-sm font-mono">
            {isLogin ? "// CONNEXION SECURISEE" : "// CREATION DE COMPTE"}
          </p>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-gray-300 font-mono text-xs">
                    PRENOM
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="pl-10 bg-black/50 border-[#39FF14]/30 text-white focus:border-[#39FF14] focus:ring-[#39FF14]/20"
                      placeholder="John"
                      data-testid="input-firstname"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-gray-300 font-mono text-xs">
                    NOM
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="pl-10 bg-black/50 border-[#39FF14]/30 text-white focus:border-[#39FF14] focus:ring-[#39FF14]/20"
                      placeholder="Doe"
                      data-testid="input-lastname"
                    />
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300 font-mono text-xs">
                EMAIL
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-black/50 border-[#39FF14]/30 text-white focus:border-[#39FF14] focus:ring-[#39FF14]/20"
                  placeholder="email@example.com"
                  required
                  data-testid="input-email"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300 font-mono text-xs">
                MOT DE PASSE
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-black/50 border-[#39FF14]/30 text-white focus:border-[#39FF14] focus:ring-[#39FF14]/20"
                  placeholder="********"
                  required
                  minLength={isLogin ? 1 : 8}
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#39FF14]"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {!isLogin && (
                <p className="text-xs text-gray-500 font-mono">Min. 8 caracteres</p>
              )}
            </div>
            
            <Button
              type="submit"
              disabled={isPending}
              className="w-full bg-[#39FF14] hover:bg-[#39FF14]/80 text-black font-bold tracking-wider mt-6"
              data-testid="button-submit-auth"
            >
              {isPending ? (
                <span className="animate-pulse">TRAITEMENT...</span>
              ) : isLogin ? (
                "CONNEXION"
              ) : (
                "CREER MON COMPTE"
              )}
            </Button>
          </form>
          
          {isLogin && (
            <div className="mt-4 text-center">
              <Link
                href="/forgot-password"
                className="text-[#39FF14]/70 hover:text-[#39FF14] text-xs font-mono transition-colors"
                data-testid="link-forgot-password"
              >
                FORGOT_PASSWORD?
              </Link>
            </div>
          )}
          
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-gray-400 hover:text-[#39FF14] text-sm font-mono transition-colors"
              data-testid="button-toggle-auth-mode"
            >
              {isLogin ? "Pas de compte ? S'inscrire" : "Deja un compte ? Se connecter"}
            </button>
          </div>
          
          <div className="mt-8 pt-4 border-t border-[#39FF14]/20">
            <p className="text-center text-xs text-gray-500 font-mono">
              CONNEXION CHIFFREE SSL/TLS
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
