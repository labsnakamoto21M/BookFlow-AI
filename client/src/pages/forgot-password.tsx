import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, KeyRound, ArrowLeft, Eye, EyeOff, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const [email, setEmail] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const resetMutation = useMutation({
    mutationFn: async (data: { email: string; recoveryPhrase: string; newPassword: string }) => {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Erreur de reinitialisation");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess(true);
      toast({
        title: "Succes",
        description: "Mot de passe reinitialise avec succes",
      });
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
    resetMutation.mutate({ email, recoveryPhrase, newPassword });
  };

  if (success) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#39FF14]/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#39FF14]/5 rounded-full blur-3xl" />
        </div>
        
        <Card className="w-full max-w-md bg-black/90 border-[#39FF14]/30 backdrop-blur-xl relative z-10">
          <CardContent className="pt-8 text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-full bg-[#39FF14]/20 flex items-center justify-center border border-[#39FF14]/50">
                <CheckCircle className="w-10 h-10 text-[#39FF14]" />
              </div>
            </div>
            
            <div>
              <h2 className="text-xl font-bold text-[#39FF14] font-mono mb-2">
                MOT DE PASSE REINITIALISE
              </h2>
              <p className="text-gray-400 text-sm font-mono">
                Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
              </p>
            </div>
            
            <Button
              onClick={() => setLocation("/auth")}
              className="w-full bg-[#39FF14] hover:bg-[#39FF14]/80 text-black font-bold tracking-wider"
              data-testid="button-go-to-login"
            >
              SE CONNECTER
            </Button>
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
              <KeyRound className="w-8 h-8 text-[#39FF14]" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-[#39FF14] tracking-wider font-mono">
            RECUPERATION_COMPTE
          </CardTitle>
          <p className="text-gray-400 text-sm font-mono">
            Entrez votre email et les 12 mots de votre phrase de recuperation
          </p>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  data-testid="input-reset-email"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="recoveryPhrase" className="text-gray-300 font-mono text-xs">
                PHRASE DE RECUPERATION (12 MOTS)
              </Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
                <textarea
                  id="recoveryPhrase"
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  className="w-full min-h-[80px] pl-10 pr-4 py-3 bg-black/50 border border-[#39FF14]/30 text-white focus:border-[#39FF14] focus:ring-[#39FF14]/20 rounded-md font-mono text-sm resize-none"
                  placeholder="mot1 mot2 mot3 mot4 mot5 mot6 mot7 mot8 mot9 mot10 mot11 mot12"
                  required
                  data-testid="input-recovery-phrase"
                />
              </div>
              <p className="text-xs text-gray-500 font-mono">
                Separee par des espaces, sans majuscules
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-gray-300 font-mono text-xs">
                NOUVEAU MOT DE PASSE
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  id="newPassword"
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-10 pr-10 bg-black/50 border-[#39FF14]/30 text-white focus:border-[#39FF14] focus:ring-[#39FF14]/20"
                  placeholder="********"
                  required
                  minLength={8}
                  data-testid="input-new-password"
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
              <p className="text-xs text-gray-500 font-mono">Min. 8 caracteres</p>
            </div>
            
            <Button
              type="submit"
              disabled={resetMutation.isPending}
              className="w-full bg-[#39FF14] hover:bg-[#39FF14]/80 text-black font-bold tracking-wider mt-6"
              data-testid="button-reset-password"
            >
              {resetMutation.isPending ? (
                <span className="animate-pulse">VERIFICATION...</span>
              ) : (
                "REINITIALISER_MOT_DE_PASSE"
              )}
            </Button>
          </form>
          
          <div className="mt-6">
            <Link
              href="/auth"
              className="flex items-center justify-center gap-2 text-gray-400 hover:text-[#39FF14] text-sm font-mono transition-colors"
              data-testid="link-back-to-login"
            >
              <ArrowLeft className="w-4 h-4" />
              RETOUR CONNEXION
            </Link>
          </div>
          
          <div className="mt-8 pt-4 border-t border-[#39FF14]/20">
            <p className="text-center text-xs text-gray-500 font-mono">
              VERIFICATION CRYPTOGRAPHIQUE BCRYPT
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
