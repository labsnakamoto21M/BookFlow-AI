import cron from "node-cron";
import { storage } from "./storage";
import { whatsappManager } from "./whatsapp";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

export function startReminderService() {
  // Run every 5 minutes to check for appointments needing reminders
  cron.schedule("*/5 * * * *", async () => {
    try {
      const appointmentsNeedingReminder = await storage.getAppointmentsNeedingReminder();
      
      for (const apt of appointmentsNeedingReminder) {
        const profile = await storage.getProviderProfileById(apt.providerId);
        if (!profile || !profile.whatsappConnected) continue;

        const service = await storage.getService(apt.serviceId);
        const appointmentDate = typeof apt.appointmentDate === 'string'
          ? parseISO(apt.appointmentDate)
          : apt.appointmentDate;

        const formattedTime = format(appointmentDate, "HH:mm", { locale: fr });
        const message = `⏰ *Rappel de rendez-vous*\n\nVotre rendez-vous ${service?.name || ""} est dans 1 heure à ${formattedTime}.\n\n📍 ${profile.address || "Adresse à confirmer"}\n\nÀ très bientôt ! 👋`;

        await whatsappManager.sendMessage(apt.providerId, apt.clientPhone, message);
        await storage.updateAppointment(apt.id, { reminderSent: true });
        
        console.log(`Reminder sent for appointment ${apt.id}`);
      }
    } catch (error) {
      console.error("Error in reminder service:", error);
    }
  });

  console.log("Reminder service started");
}
