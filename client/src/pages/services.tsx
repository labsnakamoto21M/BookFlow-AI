import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, Clock, Euro, Save, Terminal } from "lucide-react";
import type { BasePrice, ServiceExtra, CustomExtra } from "@shared/schema";

const DURATION_TIERS = [
  { duration: 15, label: "15 min" },
  { duration: 30, label: "30 min" },
  { duration: 45, label: "45 min" },
  { duration: 60, label: "1h" },
  { duration: 90, label: "1h30" },
  { duration: 120, label: "2h" },
];

const customExtraSchema = z.object({
  name: z.string().min(1, "Name required"),
  price: z.number().min(0, "Price must be positive"),
});

type CustomExtraFormValues = z.infer<typeof customExtraSchema>;

export default function ServicesPage() {
  const { toast } = useToast();
  const [isCustomExtraDialogOpen, setIsCustomExtraDialogOpen] = useState(false);
  const [basePricesState, setBasePricesState] = useState<Record<number, { pricePrivate: number; priceEscort: number; active: boolean }>>({});
  const [extrasState, setExtrasState] = useState<Record<string, { active: boolean; price: number }>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: basePrices, isLoading: loadingPrices } = useQuery<BasePrice[]>({
    queryKey: ["/api/base-prices"],
  });

  const { data: serviceExtras, isLoading: loadingExtras } = useQuery<ServiceExtra[]>({
    queryKey: ["/api/service-extras"],
  });

  const { data: customExtras, isLoading: loadingCustom } = useQuery<CustomExtra[]>({
    queryKey: ["/api/custom-extras"],
  });

  useEffect(() => {
    if (basePrices) {
      const state: Record<number, { pricePrivate: number; priceEscort: number; active: boolean }> = {};
      DURATION_TIERS.forEach((tier) => {
        const existing = basePrices.find((p) => p.duration === tier.duration);
        state[tier.duration] = {
          pricePrivate: existing?.pricePrivate ? existing.pricePrivate / 100 : 0,
          priceEscort: existing?.priceEscort ? existing.priceEscort / 100 : 0,
          active: existing?.active ?? false,
        };
      });
      setBasePricesState(state);
    }
  }, [basePrices]);

  useEffect(() => {
    if (serviceExtras) {
      const state: Record<string, { active: boolean; price: number }> = {};
      serviceExtras.forEach((extra) => {
        state[extra.extraType] = {
          active: extra.active ?? false,
          price: extra.price ? extra.price / 100 : 0,
        };
      });
      setExtrasState(state);
    }
  }, [serviceExtras]);

  const saveBasePricesMutation = useMutation({
    mutationFn: (prices: any[]) => apiRequest("PUT", "/api/base-prices", { prices }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/base-prices"] });
      toast({ title: "Saved", description: "Base prices updated" });
      setHasChanges(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save prices", variant: "destructive" });
    },
  });

  const saveExtrasMutation = useMutation({
    mutationFn: (extras: any[]) => apiRequest("PUT", "/api/service-extras", { extras }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-extras"] });
      toast({ title: "Saved", description: "Extras updated" });
      setHasChanges(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save extras", variant: "destructive" });
    },
  });

  const createCustomExtraMutation = useMutation({
    mutationFn: (data: CustomExtraFormValues) =>
      apiRequest("POST", "/api/custom-extras", { ...data, price: Math.round(data.price * 100) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-extras"] });
      toast({ title: "Created", description: "Custom extra added" });
      setIsCustomExtraDialogOpen(false);
      customExtraForm.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create extra", variant: "destructive" });
    },
  });

  const deleteCustomExtraMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/custom-extras/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-extras"] });
      toast({ title: "Deleted", description: "Custom extra removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete extra", variant: "destructive" });
    },
  });

  const customExtraForm = useForm<CustomExtraFormValues>({
    resolver: zodResolver(customExtraSchema),
    defaultValues: { name: "", price: 0 },
  });

  const handleBasePriceChange = (duration: number, field: string, value: number | boolean) => {
    setBasePricesState((prev) => ({
      ...prev,
      [duration]: { ...prev[duration], [field]: value },
    }));
    setHasChanges(true);
  };

  const handleExtraChange = (extraType: string, field: string, value: number | boolean) => {
    setExtrasState((prev) => ({
      ...prev,
      [extraType]: { ...prev[extraType], [field]: value },
    }));
    setHasChanges(true);
  };

  const saveAllChanges = () => {
    const prices = Object.entries(basePricesState).map(([duration, data]) => ({
      duration: parseInt(duration),
      pricePrivate: Math.round(data.pricePrivate * 100),
      priceEscort: Math.round(data.priceEscort * 100),
      active: data.active,
    }));
    saveBasePricesMutation.mutate(prices);

    const extras = Object.entries(extrasState).map(([extraType, data]) => ({
      extraType,
      active: data.active,
      price: Math.round(data.price * 100),
    }));
    saveExtrasMutation.mutate(extras);
  };

  if (loadingPrices || loadingExtras || loadingCustom) {
    return (
      <div className="p-6 space-y-6 bg-black min-h-screen">
        <Skeleton className="h-8 w-48 bg-[#39FF14]/20" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 bg-[#39FF14]/10" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 bg-black min-h-screen font-mono">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="h-8 w-8 text-[#39FF14]" />
          <h1 className="text-3xl font-bold text-[#39FF14] tracking-wider">
            SERVICES_CONFIG
          </h1>
        </div>
        {hasChanges && (
          <Button
            onClick={saveAllChanges}
            className="bg-[#39FF14] text-black font-mono font-bold"
            data-testid="button-save-all"
          >
            <Save className="h-4 w-4 mr-2" />
            SAVE_ALL
          </Button>
        )}
      </div>

      <Card className="bg-black border-2 border-[#39FF14] rounded-sm">
        <CardHeader className="border-b border-[#39FF14]/30">
          <CardTitle className="text-[#39FF14] font-mono flex items-center gap-2">
            <Clock className="h-5 w-5" />
            &gt; BASE_PRICES [DURATION]
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid gap-3">
            <div className="grid grid-cols-4 gap-4 text-[#39FF14]/60 text-sm font-mono border-b border-[#39FF14]/20 pb-2">
              <span>DURATION</span>
              <span>PRIVATE (EUR)</span>
              <span>ESCORT (EUR)</span>
              <span>ACTIVE</span>
            </div>
            {DURATION_TIERS.map((tier) => {
              const escortAvailable = tier.duration >= 60;
              return (
                <div
                  key={tier.duration}
                  className="grid grid-cols-4 gap-4 items-center py-2 border-b border-[#39FF14]/10"
                  data-testid={`row-duration-${tier.duration}`}
                >
                  <span className="text-[#39FF14] font-bold">{tier.label}</span>
                  <Input
                    type="number"
                    value={basePricesState[tier.duration]?.pricePrivate || 0}
                    onChange={(e) =>
                      handleBasePriceChange(tier.duration, "pricePrivate", parseFloat(e.target.value) || 0)
                    }
                    className="bg-black border-[#39FF14]/50 text-[#39FF14] font-mono focus:border-[#39FF14]"
                    data-testid={`input-private-${tier.duration}`}
                  />
                  {escortAvailable ? (
                    <Input
                      type="number"
                      value={basePricesState[tier.duration]?.priceEscort || 0}
                      onChange={(e) =>
                        handleBasePriceChange(tier.duration, "priceEscort", parseFloat(e.target.value) || 0)
                      }
                      className="bg-black border-[#39FF14]/50 text-[#39FF14] font-mono focus:border-[#39FF14]"
                      data-testid={`input-escort-${tier.duration}`}
                    />
                  ) : (
                    <span className="text-[#39FF14]/30 font-mono text-sm">N/A</span>
                  )}
                  <Switch
                    checked={basePricesState[tier.duration]?.active || false}
                    onCheckedChange={(checked) => handleBasePriceChange(tier.duration, "active", checked)}
                    className="data-[state=checked]:bg-[#39FF14]"
                    data-testid={`switch-active-${tier.duration}`}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black border-2 border-[#39FF14] rounded-sm">
        <CardHeader className="border-b border-[#39FF14]/30">
          <CardTitle className="text-[#39FF14] font-mono flex items-center gap-2">
            <Euro className="h-5 w-5" />
            &gt; EXTRAS_MENU [PREDEFINED]
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-4 text-[#39FF14]/60 text-sm font-mono border-b border-[#39FF14]/20 pb-2">
              <span>SERVICE</span>
              <span>SUPPLEMENT (EUR)</span>
              <span>ACTIVE</span>
            </div>
            {serviceExtras?.map((extra) => (
              <div
                key={extra.id}
                className="grid grid-cols-3 gap-4 items-center py-2 border-b border-[#39FF14]/10"
                data-testid={`row-extra-${extra.extraType.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <span className="text-[#39FF14]">{extra.extraType}</span>
                <Input
                  type="number"
                  value={extrasState[extra.extraType]?.price || 0}
                  onChange={(e) =>
                    handleExtraChange(extra.extraType, "price", parseFloat(e.target.value) || 0)
                  }
                  className="bg-black border-[#39FF14]/50 text-[#39FF14] font-mono focus:border-[#39FF14]"
                  data-testid={`input-extra-price-${extra.extraType.replace(/\s+/g, '-').toLowerCase()}`}
                />
                <Switch
                  checked={extrasState[extra.extraType]?.active || false}
                  onCheckedChange={(checked) => handleExtraChange(extra.extraType, "active", checked)}
                  className="data-[state=checked]:bg-[#39FF14]"
                  data-testid={`switch-extra-${extra.extraType.replace(/\s+/g, '-').toLowerCase()}`}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black border-2 border-[#39FF14] rounded-sm">
        <CardHeader className="border-b border-[#39FF14]/30 flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-[#39FF14] font-mono flex items-center gap-2">
            <Plus className="h-5 w-5" />
            &gt; CUSTOM_EXTRAS [USER_DEFINED]
          </CardTitle>
          <Dialog open={isCustomExtraDialogOpen} onOpenChange={setIsCustomExtraDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="bg-[#39FF14] text-black font-mono"
                data-testid="button-add-custom"
              >
                <Plus className="h-4 w-4 mr-1" />
                ADD_NEW
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-black border-2 border-[#39FF14] rounded-sm">
              <DialogHeader>
                <DialogTitle className="text-[#39FF14] font-mono">&gt; NEW_CUSTOM_EXTRA</DialogTitle>
              </DialogHeader>
              <Form {...customExtraForm}>
                <form
                  onSubmit={customExtraForm.handleSubmit((data) => createCustomExtraMutation.mutate(data))}
                  className="space-y-4"
                >
                  <FormField
                    control={customExtraForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[#39FF14]/80 font-mono">NAME</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="bg-black border-[#39FF14]/50 text-[#39FF14] font-mono"
                            data-testid="input-custom-name"
                          />
                        </FormControl>
                        <FormMessage className="text-red-500" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={customExtraForm.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[#39FF14]/80 font-mono">PRICE (EUR)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            className="bg-black border-[#39FF14]/50 text-[#39FF14] font-mono"
                            data-testid="input-custom-price"
                          />
                        </FormControl>
                        <FormMessage className="text-red-500" />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full bg-[#39FF14] text-black font-mono font-bold"
                    disabled={createCustomExtraMutation.isPending}
                    data-testid="button-submit-custom"
                  >
                    {createCustomExtraMutation.isPending ? "SAVING..." : "CREATE_EXTRA"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-4">
          {customExtras && customExtras.length > 0 ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-4 text-[#39FF14]/60 text-sm font-mono border-b border-[#39FF14]/20 pb-2">
                <span>NAME</span>
                <span>PRICE (EUR)</span>
                <span>ACTION</span>
              </div>
              {customExtras.map((extra) => (
                <div
                  key={extra.id}
                  className="grid grid-cols-3 gap-4 items-center py-2 border-b border-[#39FF14]/10"
                  data-testid={`row-custom-${extra.id}`}
                >
                  <span className="text-[#39FF14]">{extra.name}</span>
                  <span className="text-[#39FF14] font-mono">
                    {extra.price ? (extra.price / 100).toFixed(0) : 0} EUR
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteCustomExtraMutation.mutate(extra.id)}
                    className="text-red-500"
                    data-testid={`button-delete-custom-${extra.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[#39FF14]/40 font-mono">
              <p>&gt; NO_CUSTOM_EXTRAS_DEFINED</p>
              <p className="text-sm mt-2">&gt; Click ADD_NEW to create</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="border border-[#39FF14]/30 rounded-sm p-4 bg-[#39FF14]/5">
        <p className="text-[#39FF14]/60 font-mono text-sm">
          <span className="text-[#39FF14]">[INFO]</span> The WhatsApp bot will ask clients to choose between
          PRIVATE or ESCORT pricing, then offer available EXTRAS for additional charges.
          Total = Base Price + Selected Extras.
        </p>
      </div>
    </div>
  );
}
