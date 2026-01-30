import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, User, Link as LinkIcon, Bot } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import type { ProviderProfile } from "@shared/schema";
import { useEffect } from "react";

const profileFormSchema = z.object({
  businessName: z.string().min(1, "Nom requis"),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  customInstructions: z.string().optional(),
  externalProfileUrl: z.string().url().optional().or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileFormSchema>;

export default function ProfilePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const { data: profile, isLoading } = useQuery<ProviderProfile>({
    queryKey: ["/api/provider/profile"],
  });
  
  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      businessName: "",
      address: "",
      city: "",
      phone: "",
      customInstructions: "",
      externalProfileUrl: "",
    },
  });
  
  useEffect(() => {
    if (profile && !form.formState.isDirty) {
      form.reset({
        businessName: profile.businessName || "",
        address: profile.address || "",
        city: profile.city || "",
        phone: profile.phone || "",
        customInstructions: profile.customInstructions || "",
        externalProfileUrl: profile.externalProfileUrl || "",
      });
    }
  }, [profile, form]);
  
  const saveMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      return apiRequest("PATCH", "/api/provider/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/profile"] });
      toast({ title: t("profile.saved") });
    },
    onError: (error: any) => {
      toast({
        title: t("errors.somethingWentWrong"),
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const onSubmit = (data: ProfileFormData) => {
    saveMutation.mutate(data);
  };
  
  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="loading-profile">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[500px]" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl" data-testid="profile-page">
      <div>
        <h1 className="font-mono text-2xl font-bold text-primary" data-testid="text-profile-title">
          {t("profile.title")}
        </h1>
        <p className="font-mono text-sm text-muted-foreground">
          {t("profile.subtitle")}
        </p>
      </div>
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="form-profile">
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="font-mono text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                {t("profile.basicInfo")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("profile.businessName")}</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder={t("profile.businessNamePlaceholder")}
                        className="font-mono"
                        data-testid="input-business-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("profile.address")}</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder={t("profile.addressPlaceholder")}
                        className="font-mono"
                        data-testid="input-address"
                      />
                    </FormControl>
                    <FormDescription className="font-mono text-xs">
                      {t("profile.addressDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">{t("profile.city")}</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder={t("profile.cityPlaceholder")}
                          className="font-mono"
                          data-testid="input-city"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono">{t("profile.phone")}</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="+32..."
                          className="font-mono"
                          data-testid="input-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="font-mono text-lg flex items-center gap-2">
                <Bot className="h-5 w-5" />
                {t("profile.botInstructions")}
              </CardTitle>
              <CardDescription className="font-mono">
                {t("profile.botInstructionsDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="customInstructions"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder={t("profile.botInstructionsPlaceholder")}
                        className="font-mono min-h-[150px]"
                        data-testid="input-custom-instructions"
                      />
                    </FormControl>
                    <FormDescription className="font-mono text-xs">
                      {t("profile.botInstructionsHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="font-mono text-lg flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                {t("profile.externalUrl")}
              </CardTitle>
              <CardDescription className="font-mono">
                {t("profile.externalUrlDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="externalProfileUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono">{t("profile.externalUrlLabel")}</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="https://quartier-rouge.be/mon-profil"
                        className="font-mono"
                        data-testid="input-external-url"
                      />
                    </FormControl>
                    <FormDescription className="font-mono text-xs">
                      {t("profile.externalUrlHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          
          <Button 
            type="submit" 
            className="w-full font-mono"
            disabled={saveMutation.isPending}
            data-testid="button-save-profile"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </Form>
    </div>
  );
}
