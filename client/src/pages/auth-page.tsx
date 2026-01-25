import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, User, Eye, EyeOff, Zap } from "lucide-react";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ email, password, firstName: firstName || undefined, lastName: lastName || undefined });
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

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
