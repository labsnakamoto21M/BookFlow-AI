import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Clock, Save } from "lucide-react";
import { useState, useEffect } from "react";
import type { BusinessHours } from "@shared/schema";

const DAYS_OF_WEEK = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

interface DayHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export default function HorairesPage() {
  const { toast } = useToast();
  const [hours, setHours] = useState<DayHours[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: businessHours, isLoading } = useQuery<BusinessHours[]>({
    queryKey: ["/api/business-hours"],
  });

  useEffect(() => {
    if (businessHours) {
      const hoursMap = new Map(businessHours.map(h => [h.dayOfWeek, h]));
      const allDays = DAYS_OF_WEEK.map(day => {
        const existing = hoursMap.get(day.value);
        return {
          dayOfWeek: day.value,
          openTime: existing?.openTime || "09:00",
          closeTime: existing?.closeTime || "18:00",
          isClosed: existing?.isClosed ?? (day.value === 0),
        };
      });
      setHours(allDays);
      setHasChanges(false);
    }
  }, [businessHours]);

  const saveMutation = useMutation({
    mutationFn: (data: DayHours[]) => apiRequest("PUT", "/api/business-hours", { hours: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-hours"] });
      toast({ title: "Succès", description: "Horaires mis à jour" });
      setHasChanges(false);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de sauvegarder les horaires", variant: "destructive" });
    },
  });

  const updateDay = (dayOfWeek: number, updates: Partial<DayHours>) => {
    setHours(prev => prev.map(h => 
      h.dayOfWeek === dayOfWeek ? { ...h, ...updates } : h
    ));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(hours);
  };

  const getDayLabel = (dayOfWeek: number) => {
    return DAYS_OF_WEEK.find(d => d.value === dayOfWeek)?.label || "";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-horaires-title">Horaires d'ouverture</h1>
          <p className="text-muted-foreground">
            Définissez vos heures de travail pour chaque jour de la semaine
          </p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={!hasChanges || saveMutation.isPending}
          data-testid="button-save-hours"
        >
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>

      {/* Hours Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Planning hebdomadaire
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-10 w-28" />
                  <Skeleton className="h-10 w-28" />
                  <Skeleton className="h-6 w-12" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {hours.map((day) => (
                <div
                  key={day.dayOfWeek}
                  className={`flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg transition-colors ${
                    day.isClosed ? "bg-muted/50" : "bg-background"
                  }`}
                  data-testid={`day-${day.dayOfWeek}`}
                >
                  <div className="w-28 font-medium">
                    {getDayLabel(day.dayOfWeek)}
                  </div>
                  
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={day.openTime}
                        onChange={(e) => updateDay(day.dayOfWeek, { openTime: e.target.value })}
                        disabled={day.isClosed}
                        className="w-28"
                        data-testid={`input-open-${day.dayOfWeek}`}
                      />
                      <span className="text-muted-foreground">à</span>
                      <Input
                        type="time"
                        value={day.closeTime}
                        onChange={(e) => updateDay(day.dayOfWeek, { closeTime: e.target.value })}
                        disabled={day.isClosed}
                        className="w-28"
                        data-testid={`input-close-${day.dayOfWeek}`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${day.isClosed ? "text-muted-foreground" : "text-foreground"}`}>
                      {day.isClosed ? "Fermé" : "Ouvert"}
                    </span>
                    <Switch
                      checked={!day.isClosed}
                      onCheckedChange={(checked) => updateDay(day.dayOfWeek, { isClosed: !checked })}
                      data-testid={`switch-${day.dayOfWeek}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Comment ça fonctionne ?</p>
              <p className="text-sm text-muted-foreground">
                Le bot WhatsApp utilisera ces horaires pour proposer uniquement des créneaux disponibles 
                à vos clients. Les jours fermés, aucun rendez-vous ne sera proposé.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
