import type { Slot, Appointment } from "@shared/schema";

const ARRIVED_REGEX = /arriv[eé]|[^a-z]la[^a-z]|sur place|pr[eé]sent|ici|here|all[ií]|llegue|estoy|aangekomen|ben er|ik ben er/i;

export function getAddressToSend(
  slot: Slot,
  appointment: Appointment | null,
  currentTime: Date,
  clientMessage?: string
): { address: string; isExact: boolean } {
  const approx = slot.addressApprox || null;
  const exact = slot.addressExact || null;

  if (!appointment) {
    return { address: approx || "adresse pas encore configuree", isExact: false };
  }

  const aptDate = typeof appointment.appointmentDate === "string"
    ? new Date(appointment.appointmentDate)
    : appointment.appointmentDate;
  const minutesUntil = (aptDate.getTime() - currentTime.getTime()) / 60000;

  const clientArrived = clientMessage ? ARRIVED_REGEX.test(clientMessage) : false;

  if (minutesUntil <= 15 || clientArrived) {
    if (exact) {
      return { address: exact, isExact: true };
    }
    if (approx) {
      console.warn(`[ADDRESS] addressExact is null for slot ${slot.id}, falling back to approx`);
      return { address: approx, isExact: false };
    }
    return { address: "adresse pas encore configuree", isExact: false };
  }

  return { address: approx || "adresse pas encore configuree", isExact: false };
}

export function getApproxAddress(slot: Slot): string | null {
  return slot.addressApprox || slot.address || null;
}

export function getExactAddress(slot: Slot): string | null {
  return slot.addressExact || null;
}
