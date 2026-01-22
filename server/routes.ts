import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { whatsappManager } from "./whatsapp";
import { startReminderService } from "./reminder";
import { z } from "zod";
import { 
  insertServiceSchema, 
  insertBlockedSlotSchema, 
  insertBlacklistSchema,
  insertBasePriceSchema,
  insertServiceExtraSchema,
  insertCustomExtraSchema
} from "@shared/schema";
import { startOfWeek, endOfWeek, parseISO } from "date-fns";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);
  registerAuthRoutes(app);

  // Start reminder service
  startReminderService();

  // Helper to get provider profile for current user
  async function getOrCreateProviderProfile(req: any) {
    const userId = req.user.claims.sub;
    let profile = await storage.getProviderProfile(userId);
    
    if (!profile) {
      profile = await storage.upsertProviderProfile({
        userId,
        businessName: req.user.claims.first_name 
          ? `${req.user.claims.first_name}'s Business`
          : "Mon Entreprise",
        description: null,
        phone: null,
        address: null,
        city: null,
        whatsappConnected: false,
        whatsappSessionData: null,
        stripeCustomerId: null,
        subscriptionStatus: "trial",
      });
    }
    
    return profile;
  }

  // Provider Profile
  app.get("/api/provider/profile", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      res.json(profile);
    } catch (error) {
      console.error("Error fetching provider profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.patch("/api/provider/profile", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const updated = await storage.updateProviderProfile(profile.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating provider profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Dashboard Stats
  app.get("/api/dashboard/stats", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const stats = await storage.getDashboardStats(profile.id);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Services
  app.get("/api/services", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const services = await storage.getServices(profile.id);
      res.json(services);
    } catch (error) {
      console.error("Error fetching services:", error);
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  app.post("/api/services", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const data = insertServiceSchema.parse({ ...req.body, providerId: profile.id });
      const service = await storage.createService(data);
      res.status(201).json(service);
    } catch (error) {
      console.error("Error creating service:", error);
      res.status(500).json({ message: "Failed to create service" });
    }
  });

  app.patch("/api/services/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const service = await storage.getService(id);
      
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }

      if (service.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const updated = await storage.updateService(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating service:", error);
      res.status(500).json({ message: "Failed to update service" });
    }
  });

  app.delete("/api/services/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const service = await storage.getService(id);
      
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }

      if (service.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.deleteService(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting service:", error);
      res.status(500).json({ message: "Failed to delete service" });
    }
  });

  // Base Prices (duration-based pricing)
  app.get("/api/base-prices", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const prices = await storage.getBasePrices(profile.id);
      res.json(prices);
    } catch (error) {
      console.error("Error fetching base prices:", error);
      res.status(500).json({ message: "Failed to fetch base prices" });
    }
  });

  app.put("/api/base-prices", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { prices } = req.body;
      
      const results = [];
      for (const price of prices) {
        const result = await storage.upsertBasePrice({
          ...price,
          providerId: profile.id,
        });
        results.push(result);
      }
      
      res.json(results);
    } catch (error) {
      console.error("Error updating base prices:", error);
      res.status(500).json({ message: "Failed to update base prices" });
    }
  });

  // Service Extras (predefined extras menu)
  app.get("/api/service-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      // Initialize default extras if none exist
      await storage.initializeDefaultExtras(profile.id);
      const extras = await storage.getServiceExtras(profile.id);
      res.json(extras);
    } catch (error) {
      console.error("Error fetching service extras:", error);
      res.status(500).json({ message: "Failed to fetch service extras" });
    }
  });

  app.put("/api/service-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { extras } = req.body;
      
      const results = [];
      for (const extra of extras) {
        const result = await storage.upsertServiceExtra({
          ...extra,
          providerId: profile.id,
        });
        results.push(result);
      }
      
      res.json(results);
    } catch (error) {
      console.error("Error updating service extras:", error);
      res.status(500).json({ message: "Failed to update service extras" });
    }
  });

  // Custom Extras (user-defined)
  app.get("/api/custom-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const extras = await storage.getCustomExtras(profile.id);
      res.json(extras);
    } catch (error) {
      console.error("Error fetching custom extras:", error);
      res.status(500).json({ message: "Failed to fetch custom extras" });
    }
  });

  app.post("/api/custom-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const extra = await storage.createCustomExtra({
        ...req.body,
        providerId: profile.id,
      });
      res.status(201).json(extra);
    } catch (error) {
      console.error("Error creating custom extra:", error);
      res.status(500).json({ message: "Failed to create custom extra" });
    }
  });

  app.patch("/api/custom-extras/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const updated = await storage.updateCustomExtra(id, req.body);
      if (!updated) {
        return res.status(404).json({ message: "Custom extra not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating custom extra:", error);
      res.status(500).json({ message: "Failed to update custom extra" });
    }
  });

  app.delete("/api/custom-extras/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCustomExtra(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting custom extra:", error);
      res.status(500).json({ message: "Failed to delete custom extra" });
    }
  });

  // Business Hours
  app.get("/api/business-hours", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const hours = await storage.getBusinessHours(profile.id);
      res.json(hours);
    } catch (error) {
      console.error("Error fetching business hours:", error);
      res.status(500).json({ message: "Failed to fetch business hours" });
    }
  });

  app.put("/api/business-hours", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { hours } = req.body;
      
      const hoursWithProvider = hours.map((h: any) => ({
        ...h,
        providerId: profile.id,
      }));

      const result = await storage.upsertBusinessHours(hoursWithProvider);
      res.json(result);
    } catch (error) {
      console.error("Error updating business hours:", error);
      res.status(500).json({ message: "Failed to update business hours" });
    }
  });

  // Appointments
  app.get("/api/appointments", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const startDate = req.query.start 
        ? parseISO(req.query.start as string) 
        : startOfWeek(new Date(), { weekStartsOn: 1 });
      const endDate = req.query.end 
        ? parseISO(req.query.end as string) 
        : endOfWeek(new Date(), { weekStartsOn: 1 });

      const appointments = await storage.getAppointments(profile.id, startDate, endDate);
      
      // Get services for each appointment
      const services = await storage.getServices(profile.id);
      const serviceMap = new Map(services.map(s => [s.id, s]));
      
      const appointmentsWithService = appointments.map(apt => ({
        ...apt,
        service: serviceMap.get(apt.serviceId),
      }));

      res.json(appointmentsWithService);
    } catch (error) {
      console.error("Error fetching appointments:", error);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  app.get("/api/appointments/upcoming", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const appointments = await storage.getUpcomingAppointments(profile.id);
      
      const services = await storage.getServices(profile.id);
      const serviceMap = new Map(services.map(s => [s.id, s]));
      
      const appointmentsWithService = appointments.map(apt => ({
        ...apt,
        service: serviceMap.get(apt.serviceId),
      }));

      res.json(appointmentsWithService);
    } catch (error) {
      console.error("Error fetching upcoming appointments:", error);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  app.patch("/api/appointments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const appointment = await storage.getAppointment(id);
      
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      if (appointment.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const validStatuses = ["confirmed", "cancelled", "completed", "no-show"];
      if (req.body.status && !validStatuses.includes(req.body.status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const updated = await storage.updateAppointment(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating appointment:", error);
      res.status(500).json({ message: "Failed to update appointment" });
    }
  });

  // Blocked Slots
  app.get("/api/blocked-slots", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const startDate = req.query.start 
        ? parseISO(req.query.start as string) 
        : startOfWeek(new Date(), { weekStartsOn: 1 });
      const endDate = req.query.end 
        ? parseISO(req.query.end as string) 
        : endOfWeek(new Date(), { weekStartsOn: 1 });

      const slots = await storage.getBlockedSlots(profile.id, startDate, endDate);
      res.json(slots);
    } catch (error) {
      console.error("Error fetching blocked slots:", error);
      res.status(500).json({ message: "Failed to fetch blocked slots" });
    }
  });

  app.post("/api/blocked-slots", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const data = insertBlockedSlotSchema.parse({ ...req.body, providerId: profile.id });
      const slot = await storage.createBlockedSlot(data);
      res.status(201).json(slot);
    } catch (error) {
      console.error("Error creating blocked slot:", error);
      res.status(500).json({ message: "Failed to create blocked slot" });
    }
  });

  app.delete("/api/blocked-slots/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const slot = await storage.getBlockedSlot(id);
      
      if (!slot) {
        return res.status(404).json({ message: "Blocked slot not found" });
      }

      if (slot.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await storage.deleteBlockedSlot(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting blocked slot:", error);
      res.status(500).json({ message: "Failed to delete blocked slot" });
    }
  });

  // Blacklist
  app.get("/api/blacklist", isAuthenticated, async (req: any, res) => {
    try {
      const blacklist = await storage.getBlacklist();
      res.json(blacklist);
    } catch (error) {
      console.error("Error fetching blacklist:", error);
      res.status(500).json({ message: "Failed to fetch blacklist" });
    }
  });

  app.post("/api/blacklist", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const data = insertBlacklistSchema.parse({ ...req.body, reportedBy: profile.id });
      const entry = await storage.addToBlacklist(data);
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error adding to blacklist:", error);
      res.status(500).json({ message: "Failed to add to blacklist" });
    }
  });

  // GDPR: Messages endpoint removed - no message content is stored

  // WhatsApp
  app.get("/api/whatsapp/status", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      
      // Initialize session if not exists
      await whatsappManager.initSession(profile.id);
      
      const status = whatsappManager.getStatus(profile.id);
      res.json(status);
    } catch (error) {
      console.error("Error fetching WhatsApp status:", error);
      res.status(500).json({ message: "Failed to fetch WhatsApp status" });
    }
  });

  app.post("/api/whatsapp/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      await whatsappManager.disconnect(profile.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting WhatsApp:", error);
      res.status(500).json({ message: "Failed to disconnect WhatsApp" });
    }
  });

  app.post("/api/whatsapp/refresh-qr", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      await whatsappManager.refreshQR(profile.id);
      const status = whatsappManager.getStatus(profile.id);
      res.json(status);
    } catch (error) {
      console.error("Error refreshing QR code:", error);
      res.status(500).json({ message: "Failed to refresh QR code" });
    }
  });

  // QR Code as base64 image
  app.get("/api/whatsapp/qr", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const status = whatsappManager.getStatus(profile.id);
      
      if (!status.qrCode) {
        return res.status(404).json({ message: "QR code not available" });
      }
      
      // Return QR code as base64 data URL
      res.json({ qrCode: status.qrCode });
    } catch (error) {
      console.error("Error fetching QR code:", error);
      res.status(500).json({ message: "Failed to fetch QR code" });
    }
  });

  // ==================== No-Show Tracking & Blocking ====================
  
  // Get provider's no-show reports (clients they reported)
  app.get("/api/signalements", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const reports = await storage.getNoShowReports(profile.id);
      
      // Enrich with reliability data
      const enrichedReports = await Promise.all(
        reports.map(async (report) => {
          const reliability = await storage.getClientReliability(report.phone);
          return {
            ...report,
            noShowTotal: reliability?.noShowTotal || 1,
            lastNoShowDate: reliability?.lastNoShowDate,
          };
        })
      );
      
      res.json(enrichedReports);
    } catch (error) {
      console.error("Error fetching signalements:", error);
      res.status(500).json({ message: "Failed to fetch signalements" });
    }
  });

  // Get client reliability score
  app.get("/api/client-reliability/:phone", isAuthenticated, async (req: any, res) => {
    try {
      const { phone } = req.params;
      const reliability = await storage.getClientReliability(phone);
      res.json(reliability || { noShowTotal: 0 });
    } catch (error) {
      console.error("Error fetching client reliability:", error);
      res.status(500).json({ message: "Failed to fetch client reliability" });
    }
  });

  // Get provider's personal blocks
  app.get("/api/blocks", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const blocks = await storage.getProviderBlocks(profile.id);
      res.json(blocks);
    } catch (error) {
      console.error("Error fetching blocks:", error);
      res.status(500).json({ message: "Failed to fetch blocks" });
    }
  });

  // Block a client personally
  const blockClientSchema = z.object({
    phone: z.string().min(1, "Phone number is required").regex(/^\+?[0-9\s-]{8,}$/, "Invalid phone format"),
    reason: z.string().optional(),
  });

  app.post("/api/blocks", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const validation = blockClientSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ message: validation.error.errors[0].message });
      }
      
      const { phone, reason } = validation.data;
      const block = await storage.blockClient(profile.id, phone, reason);
      res.status(201).json(block);
    } catch (error) {
      console.error("Error blocking client:", error);
      res.status(500).json({ message: "Failed to block client" });
    }
  });

  // Unblock a client
  app.delete("/api/blocks/:phone", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { phone } = req.params;
      
      await storage.unblockClient(profile.id, phone);
      res.json({ success: true });
    } catch (error) {
      console.error("Error unblocking client:", error);
      res.status(500).json({ message: "Failed to unblock client" });
    }
  });

  return httpServer;
}
