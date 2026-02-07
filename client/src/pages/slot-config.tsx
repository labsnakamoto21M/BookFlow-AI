import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRoute, useLocation } from "wouter";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Trash2, Zap, Moon, Ghost } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { Slot } from "@shared/schema";

const createSlotFormSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(1, t("errors.nameRequired")),
  phone: z.string().optional(),
  addressApprox: z.string().optional(),
  addressExact: z.string().optional(),
  city: z.string().optional(),
  availabilityMode: z.enum(["active", "away", "ghost"]),
  customInstructions: z.string().optional(),
});

type SlotFormData = z.infer<ReturnType<typeof createSlotFormSchema>>;

export default function SlotConfigPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/slots/:id");
  const slotId = params?.id;
  const isNew = slotId === "new";
  
  const { data: slot, isLoading } = useQuery<Slot>({
    queryKey: ["/api/slots", slotId],
    enabled: !!slotId && !isNew,
  });
  
  const slotFormSchema = createSlotFormSchema(t);
  
  const form = useForm<SlotFormData>({
    resolver: zodResolver(slotFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      addressApprox: "",
      addressExact: "",
      city: "",
      availabilityMode: "active",
      customInstructions: "",
    },
  });
  
  useEffect(() => {
    if (slot && !form.formState.isDirty) {
      form.reset({
        name: slot.name,
        phone: slot.phone || "",
        addressApprox: slot.addressApprox || slot.address || "",
        addressExact: slot.addressExact || "",
        city: slot.city || "",
        availabilityMode: (slot.availabilityMode as "active" | "away" | "ghost") || "active",
        customInstructions: slot.customInstructions || "",
      });
    }
  }, [slot, form]);
  
  const saveMutation = useMutation({
    mutationFn: async (data: SlotFormData) => {
      if (isNew) {
        return apiRequest("POST", "/api/slots", data);
      }
      return apiRequest("PATCH", `/api/slots/${slotId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slots"] });
      toast({
        title: isNew ? t("slotConfig.created") : t("slotConfig.saved"),
      });
      setLocation("/overview");
    },
    onError: (error: any) => {
      toast({
        title: t("errors.somethingWentWrong"),
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/slots/${slotId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slots"] });
      toast({ title: t("slotConfig.deleted") });
      setLocation("/overview");
    },
  });
  
  const onSubmit = (data: SlotFormData) => {
    saveMutation.mutate(data);
  };
  
  if (isLoading && !isNew) {
    return (
      <div className="p-6 space-y-6" data-testid="loading-slot-config">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl" data-testid="slot-config-page">
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setLocation("/overview")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-mono text-2xl font-bold text-primary" data-testid="text-slot-config-title">
            {isNew ? t("slotConfig.createTitle") : t("slotConfig.editTitle")}
          </h1>
          <p className="font-mono text-sm text-muted-foreground" data-testid="text-slot-config-subtitle">
            {isNew ? t("slotConfig.createSubtitle") : slot?.name}
          </p>
        </div>
      </div>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="form-slot-config">
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="font-mono text-lg">
                {t("slotConfig.basicInfo")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("slotConfig.name")}</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder={t("slotConfig.namePlaceholder")}
                        className="font-mono"
                        data-testid="input-slot-name"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-slot-name" />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("slotConfig.phone")}</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="+33 6 12 34 56 78"
                        className="font-mono"
                        data-testid="input-slot-phone"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-slot-phone" />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="addressApprox"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">Adresse approximative (rue/quartier)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="ex: Boulevard d'Anvers, Saint-Josse"
                        className="font-mono"
                        data-testid="input-slot-address-approx"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Donnee au client a la confirmation du RDV
                    </p>
                    <FormMessage data-testid="error-slot-address-approx" />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="addressExact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">Adresse exacte (numero + instructions)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="ex: Boulevard d'Anvers 122, 3eme etage porte gauche"
                        className="font-mono"
                        data-testid="input-slot-address-exact"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Envoyee automatiquement 15min avant le RDV uniquement
                    </p>
                    <FormMessage data-testid="error-slot-address-exact" />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("slotConfig.city")}</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder={t("slotConfig.cityPlaceholder")}
                        className="font-mono"
                        data-testid="input-slot-city"
                      />
                    </FormControl>
                    <FormMessage data-testid="error-slot-city" />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="font-mono text-lg">
                {t("slotConfig.botSettings")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="availabilityMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("slotConfig.mode")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="font-mono" data-testid="select-slot-mode">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active" data-testid="option-mode-active">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-primary" />
                            <span>ACTIVE - {t("slotConfig.modeActiveDesc")}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="away" data-testid="option-mode-away">
                          <div className="flex items-center gap-2">
                            <Moon className="h-4 w-4 text-yellow-500" />
                            <span>AWAY - {t("slotConfig.modeAwayDesc")}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="ghost" data-testid="option-mode-ghost">
                          <div className="flex items-center gap-2">
                            <Ghost className="h-4 w-4 text-muted-foreground" />
                            <span>GHOST - {t("slotConfig.modeGhostDesc")}</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage data-testid="error-slot-mode" />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="customInstructions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("slotConfig.customInstructions")}</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder={t("slotConfig.customInstructionsPlaceholder")}
                        className="font-mono min-h-[100px] resize-y"
                        data-testid="textarea-custom-instructions"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {t("slotConfig.customInstructionsHint")}
                    </p>
                    <FormMessage data-testid="error-custom-instructions" />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          
          <div className="flex items-center justify-between gap-4">
            {!isNew && (
              <Button 
                type="button"
                variant="outline"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-destructive"
                data-testid="button-delete-slot"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("common.delete")}
              </Button>
            )}
            <div className="flex-1" />
            <Button 
              type="submit"
              disabled={saveMutation.isPending}
              className="font-mono"
              data-testid="button-save-slot"
            >
              <Save className="h-4 w-4 mr-2" />
              {isNew ? t("slotConfig.create") : t("common.save")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
