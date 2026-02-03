import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Clock, 
  User, 
  Phone,
  Calendar,
  X,
  Ban,
  MessageCircle,
  Copy,
  Users
} from "lucide-react";
import { Link } from "wouter";
import { SiWhatsapp } from "react-icons/si";
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  addWeeks, 
  subWeeks,
  isSameDay,
  parseISO,
  isToday
} from "date-fns";
import { fr } from "date-fns/locale";
import type { Appointment, BlockedSlot, Service, Slot } from "@shared/schema";

const normalizePhoneForWa = (phone: string) =>
  phone.replace(/[^\d]/g, "");

interface AppointmentWithService extends Appointment {
  service?: Service;
}

export default function AgendaPage() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithService | null>(null);
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | undefined>(undefined);
  const [blockForm, setBlockForm] = useState({
    startTime: "09:00",
    endTime: "10:00",
    reason: "",
  });

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
  
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const { data: slots } = useQuery<Slot[]>({
    queryKey: ["/api/slots"],
  });

  useEffect(() => {
    if (slots && slots.length > 0 && !activeSlotId) {
      const sorted = [...slots].sort((a, b) => {
        const sortA = a.sortOrder ?? 0;
        const sortB = b.sortOrder ?? 0;
        if (sortA !== sortB) return sortA - sortB;
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
      setActiveSlotId(sorted[0].id);
    }
  }, [slots, activeSlotId]);

  const { data: appointments, isLoading: appointmentsLoading } = useQuery<AppointmentWithService[]>({
    queryKey: ["/api/appointments", { start: weekStartStr, end: weekEndStr, slotId: activeSlotId }],
    enabled: !!activeSlotId,
  });

  const { data: blockedSlots, isLoading: blockedLoading } = useQuery<BlockedSlot[]>({
    queryKey: ["/api/blocked-slots", { start: weekStartStr, end: weekEndStr, slotId: activeSlotId }],
    enabled: !!activeSlotId,
  });

  const { data: next24h, isLoading: next24hLoading } = useQuery<AppointmentWithService[]>({
    queryKey: ["/api/appointments/next24h", { slotId: activeSlotId }],
    enabled: !!activeSlotId,
  });

  const invalidateAppointmentsQueries = () => {
    queryClient.invalidateQueries({ 
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (
          key.startsWith('/api/appointments') || 
          key.startsWith('/api/dashboard')
        );
      }
    });
  };

  const invalidateBlockedSlotsQueries = () => {
    queryClient.invalidateQueries({ 
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/blocked-slots');
      }
    });
  };

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/appointments/${id}`, { status: "cancelled" }),
    onSuccess: () => {
      invalidateAppointmentsQueries();
      toast({ title: "Succès", description: "Rendez-vous annulé" });
      setSelectedAppointment(null);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'annuler le rendez-vous", variant: "destructive" });
    },
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/appointments/${id}/noshow`),
    onSuccess: (data: any) => {
      invalidateAppointmentsQueries();
      toast({ 
        title: "No-show enregistre", 
        description: `Message d'avertissement envoye. Total absences: ${data.noShowTotal}` 
      });
      setSelectedAppointment(null);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de marquer comme no-show", variant: "destructive" });
    },
  });

  const blockMutation = useMutation({
    mutationFn: (data: { startTime: Date; endTime: Date; reason?: string }) => 
      apiRequest("POST", "/api/blocked-slots", data),
    onSuccess: () => {
      invalidateBlockedSlotsQueries();
      toast({ title: "Succès", description: "Créneau bloqué" });
      setIsBlockDialogOpen(false);
      setBlockForm({ startTime: "09:00", endTime: "10:00", reason: "" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de bloquer le créneau", variant: "destructive" });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/blocked-slots/${id}`),
    onSuccess: () => {
      invalidateBlockedSlotsQueries();
      toast({ title: "Succès", description: "Créneau débloqué" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de débloquer le créneau", variant: "destructive" });
    },
  });

  const handleBlockSubmit = () => {
    if (!selectedDay) return;
    const [startH, startM] = blockForm.startTime.split(":").map(Number);
    const [endH, endM] = blockForm.endTime.split(":").map(Number);
    
    const startTime = new Date(selectedDay);
    startTime.setHours(startH, startM, 0, 0);
    
    const endTime = new Date(selectedDay);
    endTime.setHours(endH, endM, 0, 0);

    blockMutation.mutate({
      startTime,
      endTime,
      reason: blockForm.reason || undefined,
    });
  };

  const getAppointmentsForDay = (day: Date) => {
    if (!appointments) return [];
    return appointments.filter((apt) => {
      const aptDate = typeof apt.appointmentDate === 'string' 
        ? parseISO(apt.appointmentDate) 
        : apt.appointmentDate;
      return isSameDay(aptDate, day) && apt.status !== "cancelled";
    });
  };

  const getBlockedForDay = (day: Date) => {
    if (!blockedSlots) return [];
    return blockedSlots.filter((slot) => {
      const slotDate = typeof slot.startTime === 'string' 
        ? parseISO(slot.startTime) 
        : slot.startTime;
      return isSameDay(slotDate, day);
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "confirmed": return "bg-primary text-primary-foreground";
      case "completed": return "bg-green-500 text-white";
      case "no-show": return "bg-red-500 text-white";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const isLoading = appointmentsLoading || blockedLoading;

  // Empty state when no slots exist
  if (slots && slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4" data-testid="empty-slots-state">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <Users className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Aucun slot configuré</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Vous devez d'abord créer un slot pour gérer votre agenda et recevoir des rendez-vous.
        </p>
        <Link href="/team">
          <Button data-testid="button-go-to-team">
            <Plus className="h-4 w-4 mr-2" />
            Créer un slot
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-agenda-title">Agenda</h1>
          <p className="text-muted-foreground">
            Gérez vos rendez-vous et bloquez des créneaux
          </p>
        </div>
        <div className="flex items-center gap-2">
          {slots && slots.length > 1 && (
            <Select value={activeSlotId} onValueChange={setActiveSlotId} data-testid="select-slot">
              <SelectTrigger className="w-[180px]" data-testid="select-slot">
                <SelectValue placeholder="Choisir un slot" />
              </SelectTrigger>
              <SelectContent>
                {[...slots].sort((a, b) => {
                  const sortA = a.sortOrder ?? 0;
                  const sortB = b.sortOrder ?? 0;
                  if (sortA !== sortB) return sortA - sortB;
                  const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                  const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                  return dateA - dateB;
                }).map((slot) => (
                  <SelectItem key={slot.id} value={slot.id}>
                    {slot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-4 py-2 min-w-[200px] text-center font-medium">
            {format(weekStart, "d MMM", { locale: fr })} - {format(weekEnd, "d MMM yyyy", { locale: fr })}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
            data-testid="button-next-week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Next 24h Section */}
      <Card className="mb-4" data-testid="next24h-container">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Prochaines 24h
          </CardTitle>
        </CardHeader>
        <CardContent>
          {next24hLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : next24h && next24h.length > 0 ? (
            <div className="space-y-2">
              {next24h.map((apt) => {
                const aptDate = typeof apt.appointmentDate === 'string' 
                  ? parseISO(apt.appointmentDate) 
                  : apt.appointmentDate;
                return (
                  <div 
                    key={apt.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover-elevate cursor-pointer"
                    onClick={() => setSelectedAppointment(apt)}
                    data-testid={`next24h-appointment-${apt.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium text-primary">
                        {format(aptDate, "HH:mm")}
                      </span>
                      <span className="font-medium">{apt.clientName || "Client"}</span>
                      <span className="text-muted-foreground text-sm">
                        {apt.service?.name || "Service"}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`https://wa.me/${normalizePhoneForWa(apt.clientPhone)}`, "_blank");
                      }}
                      data-testid={`next24h-whatsapp-${apt.id}`}
                    >
                      <SiWhatsapp className="h-4 w-4 text-green-500" />
                      WhatsApp
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Aucun rendez-vous dans les prochaines 24h</p>
          )}
        </CardContent>
      </Card>

      {/* Week Grid */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day, index) => (
          <Card 
            key={index} 
            className={`min-h-[300px] ${isToday(day) ? "ring-2 ring-primary" : ""}`}
          >
            <CardHeader className="p-3 pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    {format(day, "EEE", { locale: fr })}
                  </p>
                  <p className={`text-lg font-bold ${isToday(day) ? "text-primary" : ""}`}>
                    {format(day, "d")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    setSelectedDay(day);
                    setIsBlockDialogOpen(true);
                  }}
                  data-testid={`button-block-${format(day, "yyyy-MM-dd")}`}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0 space-y-1.5">
              {isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <>
                  {getBlockedForDay(day).map((slot) => {
                    const startTime = typeof slot.startTime === 'string' 
                      ? parseISO(slot.startTime) 
                      : slot.startTime;
                    const endTime = typeof slot.endTime === 'string' 
                      ? parseISO(slot.endTime) 
                      : slot.endTime;
                    return (
                      <div
                        key={slot.id}
                        className="bg-muted/50 border border-dashed rounded p-2 text-xs group relative"
                        data-testid={`blocked-slot-${slot.id}`}
                      >
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Ban className="h-3 w-3" />
                          <span>
                            {format(startTime, "HH:mm")} - {format(endTime, "HH:mm")}
                          </span>
                        </div>
                        {slot.reason && (
                          <p className="text-muted-foreground mt-0.5 truncate">{slot.reason}</p>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => unblockMutation.mutate(slot.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                  {getAppointmentsForDay(day).map((apt) => {
                    const aptDate = typeof apt.appointmentDate === 'string' 
                      ? parseISO(apt.appointmentDate) 
                      : apt.appointmentDate;
                    return (
                      <button
                        key={apt.id}
                        onClick={() => setSelectedAppointment(apt)}
                        className={`w-full text-left rounded p-2 text-xs transition-colors hover-elevate ${getStatusColor(apt.status || "confirmed")}`}
                        data-testid={`appointment-${apt.id}`}
                      >
                        <div className="font-medium">
                          {format(aptDate, "HH:mm")} - {apt.clientName || "Client"}
                        </div>
                        <div className="opacity-80 truncate">
                          {apt.service?.name || "Service"}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Appointment Details Dialog */}
      <Dialog open={!!selectedAppointment} onOpenChange={() => setSelectedAppointment(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Détails du rendez-vous</DialogTitle>
          </DialogHeader>
          {selectedAppointment && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{selectedAppointment.clientName || "Client"}</p>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {selectedAppointment.clientPhone}
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {format(
                      typeof selectedAppointment.appointmentDate === 'string'
                        ? parseISO(selectedAppointment.appointmentDate)
                        : selectedAppointment.appointmentDate,
                      "EEEE d MMMM yyyy à HH:mm",
                      { locale: fr }
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{selectedAppointment.duration} minutes</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className={getStatusColor(selectedAppointment.status || "confirmed")}>
                    {selectedAppointment.status === "confirmed" && "Confirmé"}
                    {selectedAppointment.status === "completed" && "Terminé"}
                    {selectedAppointment.status === "no-show" && "No-show"}
                    {selectedAppointment.status === "cancelled" && "Annulé"}
                  </Badge>
                </div>
              </div>

              {selectedAppointment.notes && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">{selectedAppointment.notes}</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="default"
                  className="flex-1 gap-2"
                  onClick={() => window.open(`https://wa.me/${normalizePhoneForWa(selectedAppointment.clientPhone)}`, "_blank")}
                  data-testid="button-open-whatsapp"
                >
                  <SiWhatsapp className="h-4 w-4" />
                  Ouvrir WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAppointment.clientPhone);
                    toast({ title: "Copié", description: "Numéro copié dans le presse-papiers" });
                  }}
                  data-testid="button-copy-phone"
                >
                  <Copy className="h-4 w-4" />
                  Copier le numéro
                </Button>
              </div>

              <div className="flex gap-2 pt-2">
                {selectedAppointment.status === "confirmed" && (
                  <>
                    <Button
                      variant="outline"
                      className="flex-1 border-red-500 text-red-500 hover:bg-red-500/10"
                      onClick={() => noShowMutation.mutate(selectedAppointment.id)}
                      disabled={noShowMutation.isPending}
                      data-testid="button-no-show"
                    >
                      REPORT_GHOST
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => cancelMutation.mutate(selectedAppointment.id)}
                      disabled={cancelMutation.isPending}
                      data-testid="button-cancel-appointment"
                    >
                      Annuler
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Block Slot Dialog */}
      <Dialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Bloquer un créneau {selectedDay && `- ${format(selectedDay, "EEEE d MMMM", { locale: fr })}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Heure de début</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={blockForm.startTime}
                  onChange={(e) => setBlockForm({ ...blockForm, startTime: e.target.value })}
                  data-testid="input-block-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">Heure de fin</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={blockForm.endTime}
                  onChange={(e) => setBlockForm({ ...blockForm, endTime: e.target.value })}
                  data-testid="input-block-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Raison (optionnel)</Label>
              <Textarea
                id="reason"
                placeholder="ex: Pause déjeuner, Formation..."
                value={blockForm.reason}
                onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                data-testid="input-block-reason"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBlockDialogOpen(false)}>
                Annuler
              </Button>
              <Button 
                onClick={handleBlockSubmit} 
                disabled={blockMutation.isPending}
                data-testid="button-confirm-block"
              >
                {blockMutation.isPending ? "Blocage..." : "Bloquer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
