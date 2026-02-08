import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  isToday,
  getDay
} from "date-fns";
import { fr } from "date-fns/locale";
import type { Appointment, BlockedSlot, Service, BusinessHours, Slot } from "@shared/schema";

const normalizePhoneForWa = (phone: string) =>
  phone.replace(/[^\d]/g, "");

const maskPhone = (phone: string) => {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 4) return phone;
  return digits.slice(0, 2) + "\u2022\u2022\u2022\u2022\u2022" + digits.slice(-2);
};

interface AppointmentWithService extends Appointment {
  service?: Service;
}

const SLOT_COLORS = [
  { bg: "bg-[#39FF14]/20", border: "border-l-[#39FF14]", text: "text-[#39FF14]", hex: "#39FF14" },
  { bg: "bg-cyan-500/20", border: "border-l-cyan-400", text: "text-cyan-400", hex: "#22d3ee" },
  { bg: "bg-fuchsia-500/20", border: "border-l-fuchsia-400", text: "text-fuchsia-400", hex: "#e879f9" },
  { bg: "bg-amber-500/20", border: "border-l-amber-400", text: "text-amber-400", hex: "#fbbf24" },
  { bg: "bg-purple-500/20", border: "border-l-purple-400", text: "text-purple-400", hex: "#c084fc" },
];

const ROW_HEIGHT = 48;
const MINUTES_PER_ROW = 30;
const PX_PER_MINUTE = ROW_HEIGHT / MINUTES_PER_ROW;

function parseTimeStr(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

function generateTimeSlots(startMinutes: number, endMinutes: number): string[] {
  const slots: string[] = [];
  for (let m = startMinutes; m < endMinutes; m += MINUTES_PER_ROW) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`);
  }
  return slots;
}

export default function AgendaPage() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithService | null>(null);
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | undefined>(undefined);
  const [hoveredAppointment, setHoveredAppointment] = useState<string | null>(null);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(0);
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
    if (!slots || slots.length === 0) return;
    const stored = localStorage.getItem("activeSlotId");
    const sortedSlots = [...slots].sort((a, b) => {
      const sortA = a.sortOrder ?? 0;
      const sortB = b.sortOrder ?? 0;
      if (sortA !== sortB) return sortA - sortB;
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
    if (stored && sortedSlots.some(s => s.id === stored)) {
      setActiveSlotId(stored);
    } else {
      setActiveSlotId(sortedSlots[0].id);
    }
  }, [slots]);

  useEffect(() => {
    if (activeSlotId) {
      localStorage.setItem("activeSlotId", activeSlotId);
    }
  }, [activeSlotId]);

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

  const { data: businessHoursData } = useQuery<BusinessHours[]>({
    queryKey: ["/api/business-hours", { slotId: activeSlotId }],
    enabled: !!activeSlotId,
  });

  const { dayStartMinutes, dayEndMinutes, timeSlotLabels } = useMemo(() => {
    let earliest = 8 * 60;
    let latest = 22 * 60;

    if (businessHoursData && businessHoursData.length > 0) {
      const openSlots = businessHoursData.filter(h => !h.isClosed);
      if (openSlots.length > 0) {
        const opens = openSlots.map(h => parseTimeStr(h.openTime));
        const closes = openSlots.map(h => parseTimeStr(h.closeTime));
        earliest = Math.min(...opens);
        latest = Math.max(...closes);
        earliest = Math.floor(earliest / 30) * 30;
        latest = Math.ceil(latest / 30) * 30;
        if (earliest > 0) earliest -= 30;
        if (latest < 24 * 60) latest += 30;
      }
    }

    return {
      dayStartMinutes: earliest,
      dayEndMinutes: latest,
      timeSlotLabels: generateTimeSlots(earliest, latest),
    };
  }, [businessHoursData]);

  const totalGridHeight = timeSlotLabels.length * ROW_HEIGHT;

  const invalidateAppointmentsQueries = () => {
    queryClient.invalidateQueries({ 
      queryKey: ["/api/appointments", { start: weekStartStr, end: weekEndStr, slotId: activeSlotId }]
    });
    queryClient.invalidateQueries({ 
      queryKey: ["/api/appointments/next24h", { slotId: activeSlotId }]
    });
    queryClient.invalidateQueries({ 
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/dashboard');
      }
    });
  };

  const invalidateBlockedSlotsQueries = () => {
    queryClient.invalidateQueries({ 
      queryKey: ["/api/blocked-slots", { start: weekStartStr, end: weekEndStr, slotId: activeSlotId }]
    });
  };

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/appointments/${id}`, { 
      status: "cancelled", 
      slotId: activeSlotId 
    }),
    onSuccess: () => {
      invalidateAppointmentsQueries();
      toast({ title: "Succes", description: "Rendez-vous annule" });
      setSelectedAppointment(null);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible d'annuler le rendez-vous", variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/appointments/${id}`, { 
      status: "completed", 
      slotId: activeSlotId 
    }),
    onSuccess: () => {
      invalidateAppointmentsQueries();
      toast({ title: "Succes", description: "Rendez-vous marque comme termine" });
      setSelectedAppointment(null);
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de marquer comme termine", variant: "destructive" });
    },
  });

  const noShowMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/appointments/${id}/noshow`, { 
      slotId: activeSlotId 
    }),
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
      toast({ title: "Succes", description: "Creneau bloque" });
      setIsBlockDialogOpen(false);
      setBlockForm({ startTime: "09:00", endTime: "10:00", reason: "" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de bloquer le creneau", variant: "destructive" });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/blocked-slots/${id}`),
    onSuccess: () => {
      invalidateBlockedSlotsQueries();
      toast({ title: "Succes", description: "Creneau debloque" });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de debloquer le creneau", variant: "destructive" });
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

  const getSlotColorIndex = useCallback(() => {
    if (!slots || !activeSlotId) return 0;
    const sortedSlots = [...slots].sort((a, b) => {
      const sortA = a.sortOrder ?? 0;
      const sortB = b.sortOrder ?? 0;
      if (sortA !== sortB) return sortA - sortB;
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });
    const idx = sortedSlots.findIndex(s => s.id === activeSlotId);
    return idx >= 0 ? idx % SLOT_COLORS.length : 0;
  }, [slots, activeSlotId]);

  const slotColor = SLOT_COLORS[getSlotColorIndex()];

  const getStatusStyles = (status: string) => {
    switch (status) {
      case "confirmed": return { bg: slotColor.bg, border: slotColor.border, text: slotColor.text };
      case "completed": return { bg: "bg-green-500/20", border: "border-l-green-500", text: "text-green-400" };
      case "no-show": return { bg: "bg-red-500/20", border: "border-l-red-500", text: "text-red-400" };
      default: return { bg: "bg-muted/30", border: "border-l-muted-foreground", text: "text-muted-foreground" };
    }
  };

  const getPositionForTime = (date: Date) => {
    const minutes = date.getHours() * 60 + date.getMinutes();
    const offset = minutes - dayStartMinutes;
    return Math.max(0, offset * PX_PER_MINUTE);
  };

  const getHeightForDuration = (durationMinutes: number) => {
    return Math.max(ROW_HEIGHT * 0.5, durationMinutes * PX_PER_MINUTE);
  };

  const handleDayColumnClick = (e: React.MouseEvent<HTMLDivElement>, day: Date) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const yOffset = e.clientY - rect.top;
    const minutesFromStart = Math.floor(yOffset / PX_PER_MINUTE);
    const totalMinutes = dayStartMinutes + minutesFromStart;
    const roundedMinutes = Math.floor(totalMinutes / 30) * 30;
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;
    const startStr = `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
    const endMinutes = roundedMinutes + 30;
    const endH = Math.floor(endMinutes / 60);
    const endM = endMinutes % 60;
    const endStr = `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;

    setSelectedDay(day);
    setBlockForm({ startTime: startStr, endTime: endStr, reason: "" });
    setIsBlockDialogOpen(true);
  };

  const isClosedDay = (day: Date) => {
    if (!businessHoursData || businessHoursData.length === 0) return false;
    const dow = getDay(day);
    const dayHours = businessHoursData.find(h => h.dayOfWeek === dow);
    return dayHours?.isClosed === true;
  };

  const isLoading = appointmentsLoading || blockedLoading;

  if (slots && slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4" data-testid="empty-slots-state">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <Users className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Aucun slot configure</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Vous devez d'abord creer un slot pour gerer votre agenda et recevoir des rendez-vous.
        </p>
        <Link href="/team">
          <Button data-testid="button-go-to-team">
            <Plus className="h-4 w-4 mr-2" />
            Creer un slot
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono" data-testid="text-agenda-title">Agenda</h1>
          <p className="text-muted-foreground text-sm">
            Gerez vos rendez-vous et bloquez des creneaux
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {slots && slots.length > 1 && (
            <Select value={activeSlotId} onValueChange={setActiveSlotId}>
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
                }).map((slot, idx) => (
                  <SelectItem key={slot.id} value={slot.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: SLOT_COLORS[idx % SLOT_COLORS.length].hex }}
                      />
                      {slot.name}
                    </span>
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
          <div className="px-3 py-2 min-w-[180px] text-center font-mono text-sm">
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
      <Card data-testid="next24h-container">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Prochaines 24h
          </CardTitle>
        </CardHeader>
        <CardContent>
          {next24hLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : next24h && next24h.length > 0 ? (
            <div className="space-y-1.5">
              {next24h.map((apt) => {
                const aptDate = typeof apt.appointmentDate === 'string' 
                  ? parseISO(apt.appointmentDate) 
                  : apt.appointmentDate;
                return (
                  <div 
                    key={apt.id}
                    className="flex items-center justify-between gap-2 p-2.5 bg-muted/50 rounded-md hover-elevate cursor-pointer"
                    onClick={() => setSelectedAppointment(apt)}
                    data-testid={`next24h-appointment-${apt.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium text-primary text-sm">
                        {format(aptDate, "HH:mm")}
                      </span>
                      <span className="font-medium text-sm">{apt.clientName || "Client"}</span>
                      <span className="text-muted-foreground text-xs hidden sm:inline">
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
                      <SiWhatsapp className="h-3.5 w-3.5 text-green-500" />
                      <span className="hidden sm:inline">WhatsApp</span>
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

      {/* Mobile Day Selector */}
      <div className="flex gap-1 overflow-x-auto md:hidden pb-1" data-testid="mobile-day-tabs">
        {weekDays.map((day, idx) => (
          <Button
            key={idx}
            variant={mobileSelectedDay === idx ? "default" : "outline"}
            size="sm"
            className="flex-shrink-0 font-mono text-xs"
            onClick={() => setMobileSelectedDay(idx)}
            data-testid={`mobile-day-tab-${idx}`}
          >
            <span className="uppercase">{format(day, "EEE", { locale: fr })}</span>
            <span className="ml-1">{format(day, "d")}</span>
          </Button>
        ))}
      </div>

      {/* Calendar Grid */}
      <Card className="overflow-hidden" data-testid="calendar-grid">
        {isLoading ? (
          <CardContent className="p-4">
            <Skeleton className="h-[400px] w-full" />
          </CardContent>
        ) : (
          <>
            {/* Day Headers - Desktop */}
            <div className="hidden md:grid border-b" style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}>
              <div className="p-2 border-r border-border/50" />
              {weekDays.map((day, idx) => (
                <div
                  key={idx}
                  className={`p-2 text-center border-r border-border/30 last:border-r-0 ${
                    isToday(day) ? "bg-primary/10" : ""
                  } ${isClosedDay(day) ? "opacity-40" : ""}`}
                  data-testid={`day-header-${format(day, "yyyy-MM-dd")}`}
                >
                  <p className="text-xs text-muted-foreground uppercase font-mono">
                    {format(day, "EEE", { locale: fr })}
                  </p>
                  <p className={`text-lg font-bold font-mono ${isToday(day) ? "text-primary" : ""}`}>
                    {format(day, "d")}
                  </p>
                  {isClosedDay(day) && (
                    <Badge variant="secondary" className="text-[10px] mt-0.5">Ferme</Badge>
                  )}
                </div>
              ))}
            </div>

            {/* Mobile Day Header */}
            <div className="md:hidden border-b p-2 text-center" data-testid="mobile-day-header">
              <p className="text-xs text-muted-foreground uppercase font-mono">
                {format(weekDays[mobileSelectedDay], "EEEE", { locale: fr })}
              </p>
              <p className={`text-xl font-bold font-mono ${isToday(weekDays[mobileSelectedDay]) ? "text-primary" : ""}`}>
                {format(weekDays[mobileSelectedDay], "d MMMM", { locale: fr })}
              </p>
            </div>

            {/* Time Grid */}
            <div className="overflow-auto max-h-[65vh]" data-testid="time-grid-scroll">
              {/* Desktop Grid */}
              <div
                className="hidden md:grid relative"
                style={{
                  gridTemplateColumns: "60px repeat(7, 1fr)",
                  height: `${totalGridHeight}px`,
                }}
                data-testid="desktop-grid"
              >
                {/* Time Axis */}
                <div className="relative border-r border-border/50">
                  {timeSlotLabels.map((label, idx) => (
                    <div
                      key={label}
                      className="absolute right-0 left-0 flex items-start justify-end pr-2"
                      style={{ top: `${idx * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                    >
                      <span className="text-[10px] text-muted-foreground font-mono -mt-1.5" data-testid={`time-label-${label}`}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Day Columns */}
                {weekDays.map((day, dayIdx) => (
                  <div
                    key={dayIdx}
                    className={`relative border-r border-border/30 last:border-r-0 ${
                      isClosedDay(day) ? "bg-muted/20" : ""
                    } ${isToday(day) ? "bg-primary/5" : ""}`}
                    style={{ height: `${totalGridHeight}px` }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-appointment]') || (e.target as HTMLElement).closest('[data-blocked]')) return;
                      handleDayColumnClick(e, day);
                    }}
                    data-testid={`day-column-${format(day, "yyyy-MM-dd")}`}
                  >
                    {/* Horizontal Grid Lines */}
                    {timeSlotLabels.map((_, idx) => (
                      <div
                        key={idx}
                        className={`absolute left-0 right-0 border-t ${
                          idx % 2 === 0 ? "border-border/40" : "border-border/20"
                        }`}
                        style={{ top: `${idx * ROW_HEIGHT}px` }}
                      />
                    ))}

                    {/* Current Time Indicator */}
                    {isToday(day) && (() => {
                      const now = new Date();
                      const nowMinutes = now.getHours() * 60 + now.getMinutes();
                      if (nowMinutes >= dayStartMinutes && nowMinutes <= dayEndMinutes) {
                        const top = (nowMinutes - dayStartMinutes) * PX_PER_MINUTE;
                        return (
                          <div
                            className="absolute left-0 right-0 z-20 pointer-events-none"
                            style={{ top: `${top}px` }}
                            data-testid="current-time-indicator"
                          >
                            <div className="flex items-center">
                              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                              <div className="flex-1 h-[2px] bg-red-500" />
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Blocked Slots */}
                    {getBlockedForDay(day).map((blocked) => {
                      const start = typeof blocked.startTime === 'string' ? parseISO(blocked.startTime) : blocked.startTime;
                      const end = typeof blocked.endTime === 'string' ? parseISO(blocked.endTime) : blocked.endTime;
                      const top = getPositionForTime(start);
                      const durationMin = (end.getTime() - start.getTime()) / 60000;
                      const height = getHeightForDuration(durationMin);

                      return (
                        <div
                          key={blocked.id}
                          data-blocked
                          className="absolute left-1 right-1 z-10 bg-red-500/10 border border-dashed border-red-500/40 rounded-md overflow-hidden cursor-pointer group"
                          style={{ top: `${top}px`, height: `${height}px`, minHeight: "20px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Debloquer ce creneau ?")) {
                              unblockMutation.mutate(blocked.id);
                            }
                          }}
                          data-testid={`blocked-slot-${blocked.id}`}
                        >
                          <div className="px-1.5 py-0.5 h-full flex flex-col justify-center">
                            <div className="flex items-center gap-1 text-red-400 text-[10px] font-mono">
                              <Ban className="h-2.5 w-2.5 flex-shrink-0" />
                              <span>{format(start, "HH:mm")}-{format(end, "HH:mm")}</span>
                            </div>
                            {blocked.reason && durationMin >= 30 && (
                              <p className="text-red-400/70 text-[9px] truncate mt-0.5">{blocked.reason}</p>
                            )}
                          </div>
                          <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="h-3 w-3 text-red-400" />
                          </div>
                        </div>
                      );
                    })}

                    {/* Appointments */}
                    {getAppointmentsForDay(day).map((apt) => {
                      const aptDate = typeof apt.appointmentDate === 'string' ? parseISO(apt.appointmentDate) : apt.appointmentDate;
                      const top = getPositionForTime(aptDate);
                      const height = getHeightForDuration(apt.duration || 30);
                      const styles = getStatusStyles(apt.status || "confirmed");
                      const isHovered = hoveredAppointment === apt.id;

                      return (
                        <div
                          key={apt.id}
                          data-appointment
                          className={`absolute left-1 right-1 rounded-md border-l-[3px] cursor-pointer transition-all ${styles.bg} ${styles.border} ${isHovered ? "z-30 shadow-lg ring-1 ring-border" : "z-10 overflow-hidden"}`}
                          style={{ 
                            top: `${top}px`, 
                            minHeight: isHovered ? "auto" : `${height}px`,
                            height: isHovered ? "auto" : `${height}px`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAppointment(apt);
                          }}
                          onMouseEnter={() => setHoveredAppointment(apt.id)}
                          onMouseLeave={() => setHoveredAppointment(null)}
                          data-testid={`appointment-${apt.id}`}
                        >
                          <div className="px-1.5 py-0.5 h-full flex flex-col justify-center">
                            <div className={`text-[10px] font-mono font-medium ${styles.text}`}>
                              {format(aptDate, "HH:mm")}
                            </div>
                            {(apt.duration || 30) >= 30 && (
                              <div className="text-[10px] truncate text-foreground/80">
                                {apt.clientName || "Client"}
                              </div>
                            )}
                            {(apt.duration || 30) >= 60 && (
                              <div className="text-[9px] truncate text-muted-foreground">
                                {apt.service?.name || ""}
                              </div>
                            )}
                          </div>

                          {/* Expanded Details on Hover */}
                          {isHovered && (
                            <div className="px-1.5 pb-1 space-y-0.5 border-t border-border/20 mt-0.5" data-testid={`tooltip-appointment-${apt.id}`}>
                              <div className="flex items-center gap-1 text-[10px]">
                                <Phone className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                                <span className="font-mono text-muted-foreground">{maskPhone(apt.clientPhone)}</span>
                              </div>
                              <div className="flex items-center gap-1 text-[10px]">
                                <Clock className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
                                <span className="font-mono text-muted-foreground">
                                  {format(aptDate, "HH:mm")}-{format(new Date(aptDate.getTime() + (apt.duration || 30) * 60000), "HH:mm")}
                                </span>
                              </div>
                              {apt.service?.name && (
                                <div className="text-[10px] text-muted-foreground truncate">{apt.service.name}</div>
                              )}
                              {apt.notes && (
                                <div className="text-[9px] text-muted-foreground/70 truncate">{apt.notes}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Mobile Grid - Single Day */}
              <div
                className="md:hidden relative"
                style={{ height: `${totalGridHeight}px` }}
                data-testid="mobile-grid"
              >
                {/* Combined Time Axis + Day Column for Mobile */}
                <div
                  className="relative"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "50px 1fr",
                    height: `${totalGridHeight}px`,
                  }}
                >
                  {/* Mobile Time Axis */}
                  <div className="relative border-r border-border/50">
                    {timeSlotLabels.map((label, idx) => (
                      <div
                        key={label}
                        className="absolute right-0 left-0 flex items-start justify-end pr-1.5"
                        style={{ top: `${idx * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
                      >
                        <span className="text-[9px] text-muted-foreground font-mono -mt-1.5">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Mobile Day Column */}
                  <div
                    className={`relative ${isToday(weekDays[mobileSelectedDay]) ? "bg-primary/5" : ""}`}
                    style={{ height: `${totalGridHeight}px` }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-appointment]') || (e.target as HTMLElement).closest('[data-blocked]')) return;
                      handleDayColumnClick(e, weekDays[mobileSelectedDay]);
                    }}
                  >
                    {/* Grid Lines */}
                    {timeSlotLabels.map((_, idx) => (
                      <div
                        key={idx}
                        className={`absolute left-0 right-0 border-t ${
                          idx % 2 === 0 ? "border-border/40" : "border-border/20"
                        }`}
                        style={{ top: `${idx * ROW_HEIGHT}px` }}
                      />
                    ))}

                    {/* Current Time Indicator (Mobile) */}
                    {isToday(weekDays[mobileSelectedDay]) && (() => {
                      const now = new Date();
                      const nowMinutes = now.getHours() * 60 + now.getMinutes();
                      if (nowMinutes >= dayStartMinutes && nowMinutes <= dayEndMinutes) {
                        const top = (nowMinutes - dayStartMinutes) * PX_PER_MINUTE;
                        return (
                          <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${top}px` }}>
                            <div className="flex items-center">
                              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                              <div className="flex-1 h-[2px] bg-red-500" />
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Mobile Blocked Slots */}
                    {getBlockedForDay(weekDays[mobileSelectedDay]).map((blocked) => {
                      const start = typeof blocked.startTime === 'string' ? parseISO(blocked.startTime) : blocked.startTime;
                      const end = typeof blocked.endTime === 'string' ? parseISO(blocked.endTime) : blocked.endTime;
                      const top = getPositionForTime(start);
                      const durationMin = (end.getTime() - start.getTime()) / 60000;
                      const height = getHeightForDuration(durationMin);

                      return (
                        <div
                          key={blocked.id}
                          data-blocked
                          className="absolute left-1 right-1 z-10 bg-red-500/10 border border-dashed border-red-500/40 rounded-md overflow-hidden cursor-pointer"
                          style={{ top: `${top}px`, height: `${height}px`, minHeight: "20px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Debloquer ce creneau ?")) {
                              unblockMutation.mutate(blocked.id);
                            }
                          }}
                          data-testid={`blocked-slot-${blocked.id}`}
                        >
                          <div className="px-2 py-1 h-full flex items-center gap-2">
                            <Ban className="h-3 w-3 text-red-400 flex-shrink-0" />
                            <span className="text-red-400 text-xs font-mono">
                              {format(start, "HH:mm")}-{format(end, "HH:mm")}
                            </span>
                            {blocked.reason && (
                              <span className="text-red-400/60 text-xs truncate">{blocked.reason}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Mobile Appointments */}
                    {getAppointmentsForDay(weekDays[mobileSelectedDay]).map((apt) => {
                      const aptDate = typeof apt.appointmentDate === 'string' ? parseISO(apt.appointmentDate) : apt.appointmentDate;
                      const top = getPositionForTime(aptDate);
                      const height = getHeightForDuration(apt.duration || 30);
                      const styles = getStatusStyles(apt.status || "confirmed");

                      return (
                        <div
                          key={apt.id}
                          data-appointment
                          className={`absolute left-1 right-1 z-10 rounded-md border-l-[3px] overflow-hidden cursor-pointer ${styles.bg} ${styles.border}`}
                          style={{ top: `${top}px`, height: `${height}px`, minHeight: "28px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAppointment(apt);
                          }}
                          data-testid={`appointment-${apt.id}`}
                        >
                          <div className="px-2 py-1 h-full flex items-center gap-2">
                            <span className={`text-xs font-mono font-medium ${styles.text}`}>
                              {format(aptDate, "HH:mm")}
                            </span>
                            <span className="text-xs truncate text-foreground/80">
                              {apt.clientName || "Client"}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate hidden min-[400px]:inline">
                              {apt.service?.name || ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Appointment Details Dialog */}
      <Dialog open={!!selectedAppointment} onOpenChange={() => setSelectedAppointment(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Details du rendez-vous</DialogTitle>
          </DialogHeader>
          {selectedAppointment && (() => {
            const aptDate = typeof selectedAppointment.appointmentDate === 'string'
              ? parseISO(selectedAppointment.appointmentDate)
              : selectedAppointment.appointmentDate;
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-md">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium" data-testid="text-detail-client-name">{selectedAppointment.clientName || "Client"}</p>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <span data-testid="text-detail-client-phone">{selectedAppointment.clientPhone}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span data-testid="text-detail-date">
                      {format(aptDate, "EEEE d MMMM yyyy 'a' HH:mm", { locale: fr })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span data-testid="text-detail-duration">{selectedAppointment.duration} minutes</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={`${getStatusStyles(selectedAppointment.status || "confirmed").bg} ${getStatusStyles(selectedAppointment.status || "confirmed").text}`} data-testid="badge-detail-status">
                      {selectedAppointment.status === "confirmed" && "Confirme"}
                      {selectedAppointment.status === "completed" && "Termine"}
                      {selectedAppointment.status === "no-show" && "No-show"}
                      {selectedAppointment.status === "cancelled" && "Annule"}
                    </Badge>
                  </div>
                </div>

                {selectedAppointment.notes && (
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-sm text-muted-foreground" data-testid="text-detail-notes">{selectedAppointment.notes}</p>
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
                      toast({ title: "Copie", description: "Numero copie dans le presse-papiers" });
                    }}
                    data-testid="button-copy-phone"
                  >
                    <Copy className="h-4 w-4" />
                    Copier
                  </Button>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  {selectedAppointment.status === "confirmed" && (
                    <>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            if (window.confirm("Marquer ce rendez-vous comme termine ?")) {
                              completeMutation.mutate(selectedAppointment.id);
                            }
                          }}
                          disabled={completeMutation.isPending}
                          data-testid="button-complete-appointment"
                        >
                          Termine
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-orange-500 text-orange-500"
                          onClick={() => {
                            if (window.confirm("Signaler ce client comme absent (no-show) ? Un avertissement lui sera envoye.")) {
                              noShowMutation.mutate(selectedAppointment.id);
                            }
                          }}
                          disabled={noShowMutation.isPending}
                          data-testid="button-no-show"
                        >
                          No-show
                        </Button>
                      </div>
                      <Button
                        variant="destructive"
                        className="w-full"
                        onClick={() => {
                          if (window.confirm("Annuler ce rendez-vous ?")) {
                            cancelMutation.mutate(selectedAppointment.id);
                          }
                        }}
                        disabled={cancelMutation.isPending}
                        data-testid="button-cancel-appointment"
                      >
                        Annuler le rendez-vous
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Block Slot Dialog */}
      <Dialog open={isBlockDialogOpen} onOpenChange={setIsBlockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Bloquer un creneau {selectedDay && `- ${format(selectedDay, "EEEE d MMMM", { locale: fr })}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Heure de debut</Label>
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
                placeholder="ex: Pause dejeuner, Formation..."
                value={blockForm.reason}
                onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                data-testid="input-block-reason"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsBlockDialogOpen(false)} data-testid="button-cancel-block">
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
