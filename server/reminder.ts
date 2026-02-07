import cron from "node-cron";
import { storage } from "./storage";
import { whatsappManager } from "./whatsapp";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { getAddressToSend } from "./utils/address";

export function startReminderService() {
  // Run every 5 minutes to check for appointments needing reminders (1h before)
  cron.schedule("*/5 * * * *", async () => {
    try {
      const appointmentsNeedingReminder = await storage.getAppointmentsNeedingReminder();
      
      for (const apt of appointmentsNeedingReminder) {
        const profile = await storage.getProviderProfileById(apt.providerId);
        if (!profile) continue;

        const service = apt.serviceId ? await storage.getService(apt.serviceId) : null;
        const appointmentDate = typeof apt.appointmentDate === 'string'
          ? parseISO(apt.appointmentDate as string)
          : apt.appointmentDate;

        const formattedTime = format(appointmentDate, "HH:mm", { locale: fr });
        
        // Use slot's approximate address for 1h reminder (exact address sent at T-15)
        let addressText = profile.address || "Adresse à confirmer";
        if (apt.slotId) {
          const slot = await storage.getSlot(apt.slotId);
          if (slot) {
            addressText = slot.addressApprox || profile.address || "Adresse à confirmer";
          }
        }
        
        const message = `rappel: ton rdv est dans 1h a ${formattedTime}. je suis vers ${addressText}. je tenvoi le num exact 15min avant. sois a l'heure.`;

        await whatsappManager.sendMessage(apt.providerId, apt.clientPhone, message);
        await storage.updateAppointment(apt.id, { reminderSent: true });
        
        console.log(`[REMINDER] 1h reminder sent for appointment ${apt.id}`);
      }
    } catch (error) {
      console.error("[REMINDER] Error in reminder service:", error);
    }
  });

  // T-15 auto-send: Every minute, check for confirmed appointments within 15min and send exact address
  cron.schedule("* * * * *", async () => {
    try {
      const upcomingAppointments = await storage.getAppointmentsNeedingExactAddress();
      
      for (const apt of upcomingAppointments) {
        if (!apt.slotId) continue;
        const slot = await storage.getSlot(apt.slotId);
        if (!slot) continue;
        
        const exact = slot.addressExact;
        if (!exact) continue;
        
        const appointmentDate = typeof apt.appointmentDate === 'string'
          ? parseISO(apt.appointmentDate as string)
          : apt.appointmentDate;
        const formattedTime = format(appointmentDate, "HH:mm", { locale: fr });
        
        const message = `c'est bientot. voila l'adresse exacte: ${exact}. google maps. rdv a ${formattedTime}. sois a l'heure.`;
        
        await whatsappManager.sendMessage(apt.providerId, apt.clientPhone, message);
        await storage.updateAppointment(apt.id, { exactAddressSent: true });
        
        console.log(`[T-15] Exact address sent for appointment ${apt.id}`);
      }
    } catch (error) {
      console.error("[T-15] Error in exact address auto-send:", error);
    }
  });

  console.log("Reminder service started");
}
