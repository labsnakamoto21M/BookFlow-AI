import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerAuthRoutes, isAuthenticated, isAdmin } from "./auth";
import { whatsappManager } from "./whatsapp";
import { startReminderService } from "./reminder";
import { getUncachableStripeClient } from "./stripeClient";
import { SUBSCRIPTION_PLANS, getMaxSlotsByPlan, getPlanByPriceId, getPriceIdForPlan } from "./stripe-plans";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { 
  insertServiceSchema, 
  insertBlockedSlotSchema, 
  insertBlacklistSchema,
  insertBasePriceSchema,
  insertServiceExtraSchema,
  insertCustomExtraSchema,
  insertSlotSchema
} from "@shared/schema";
import { startOfWeek, endOfWeek, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

const BRUSSELS_TZ = "Europe/Brussels";

// Slot helper: Get default slotId for provider (first by sortOrder, then createdAt)
async function getDefaultSlotId(providerId: string): Promise<string> {
  const providerSlots = await storage.getSlots(providerId);
  if (providerSlots.length === 0) {
    throw { status: 400, message: "no slot configured" };
  }
  const sorted = providerSlots.sort((a, b) => {
    const sortA = a.sortOrder ?? 0;
    const sortB = b.sortOrder ?? 0;
    if (sortA !== sortB) return sortA - sortB;
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateA - dateB;
  });
  return sorted[0].id;
}

// Slot helper: Get active slotId from request (query/body) or fallback to default
async function getActiveSlotId(req: any, providerId: string): Promise<string> {
  const requestedSlotId = req.query?.slotId || req.body?.slotId;
  
  if (requestedSlotId) {
    // Validate ownership
    const slot = await storage.getSlot(requestedSlotId);
    if (slot && slot.providerId === providerId) {
      return requestedSlotId;
    }
  }
  
  // Fallback to default
  return await getDefaultSlotId(providerId);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerAuthRoutes(app);

  // Start reminder service
  startReminderService();

  async function getOrCreateProviderProfile(req: any) {
    const userId = req.user.id;
    let profile = await storage.getProviderProfile(userId);
    
    if (!profile) {
      profile = await storage.upsertProviderProfile({
        userId,
        businessName: req.user.firstName 
          ? `${req.user.firstName}'s Business`
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
      const user = await storage.getUserById(req.user.id);
      res.json({
        ...profile,
        subscriptionPlan: user?.subscriptionPlan || 'solo',
      });
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
      const slotId = await getActiveSlotId(req, profile.id);
      const prices = await storage.getBasePrices(profile.id, slotId);
      res.json(prices);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching base prices:", error);
      res.status(500).json({ message: "Failed to fetch base prices" });
    }
  });

  app.put("/api/base-prices", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { prices } = req.body;
      
      const results = [];
      for (const price of prices) {
        const result = await storage.upsertBasePrice({
          ...price,
          providerId: profile.id,
          slotId,
        });
        results.push(result);
      }
      
      res.json(results);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error updating base prices:", error);
      res.status(500).json({ message: "Failed to update base prices" });
    }
  });

  // Slots (Multi-agent management)
  app.get("/api/slots", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotsList = await storage.getSlots(profile.id);
      res.json(slotsList);
    } catch (error) {
      console.error("Error fetching slots:", error);
      res.status(500).json({ message: "Failed to fetch slots" });
    }
  });

  app.post("/api/slots", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const isDev = process.env.REPLIT_DEPLOYMENT !== "1";
      const maxSlots = profile.maxSlots || 1;
      const existingSlots = await storage.getSlots(profile.id);
      
      // En prod: limite active. En dev: bypass.
      if (!isDev && existingSlots.length >= maxSlots) {
        return res.status(403).json({ 
          message: `Limite de ${maxSlots} numero(s) atteinte. Passez a un plan superieur.`,
          maxSlots,
          currentCount: existingSlots.length
        });
      }
      
      const data = insertSlotSchema.parse({ 
        ...req.body, 
        providerId: profile.id,
        sortOrder: existingSlots.length
      });
      
      if (data.phone) {
        const phoneCheck = await storage.isPhoneUsedByAnotherSlot(data.phone);
        if (phoneCheck.used) {
          return res.status(409).json({ 
            message: `Ce numero est deja utilise par "${phoneCheck.slotName}". Un numero WhatsApp ne peut etre associe qu'a un seul slot.`
          });
        }
      }
      
      const slot = await storage.createSlot(data);
      res.status(201).json(slot);
    } catch (error) {
      console.error("Error creating slot:", error);
      res.status(500).json({ message: "Failed to create slot" });
    }
  });

  app.get("/api/slots/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const slot = await storage.getSlot(id);
      
      if (!slot) {
        return res.status(404).json({ message: "Slot not found" });
      }
      
      if (slot.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      res.json(slot);
    } catch (error) {
      console.error("Error fetching slot:", error);
      res.status(500).json({ message: "Failed to fetch slot" });
    }
  });

  app.patch("/api/slots/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const slot = await storage.getSlot(id);
      
      if (!slot) {
        return res.status(404).json({ message: "Slot not found" });
      }
      
      if (slot.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      if (req.body.phone) {
        const phoneCheck = await storage.isPhoneUsedByAnotherSlot(req.body.phone, id);
        if (phoneCheck.used) {
          return res.status(409).json({ 
            message: `Ce numero est deja utilise par "${phoneCheck.slotName}". Un numero WhatsApp ne peut etre associe qu'a un seul slot.`
          });
        }
      }
      
      const updated = await storage.updateSlot(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating slot:", error);
      res.status(500).json({ message: "Failed to update slot" });
    }
  });

  app.delete("/api/slots/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const slot = await storage.getSlot(id);
      
      if (!slot) {
        return res.status(404).json({ message: "Slot not found" });
      }
      
      if (slot.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      await storage.deleteSlot(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting slot:", error);
      res.status(500).json({ message: "Failed to delete slot" });
    }
  });

  // Slot manual override (pause bot for 24h)
  app.post("/api/slots/:id/manual-override", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const slot = await storage.getSlot(id);
      
      if (!slot || slot.providerId !== profile.id) {
        return res.status(404).json({ message: "Slot not found" });
      }
      
      const overrideUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      const updated = await storage.updateSlot(id, { manualOverrideUntil: overrideUntil });
      res.json(updated);
    } catch (error) {
      console.error("Error setting manual override:", error);
      res.status(500).json({ message: "Failed to set manual override" });
    }
  });

  app.delete("/api/slots/:id/manual-override", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { id } = req.params;
      const slot = await storage.getSlot(id);
      
      if (!slot || slot.providerId !== profile.id) {
        return res.status(404).json({ message: "Slot not found" });
      }
      
      const updated = await storage.updateSlot(id, { manualOverrideUntil: null });
      res.json(updated);
    } catch (error) {
      console.error("Error clearing manual override:", error);
      res.status(500).json({ message: "Failed to clear manual override" });
    }
  });

  // Service Extras (predefined extras menu)
  app.get("/api/service-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      // Initialize default extras if none exist for this slot
      await storage.initializeDefaultExtras(profile.id, slotId);
      const extras = await storage.getServiceExtras(profile.id, slotId);
      res.json(extras);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching service extras:", error);
      res.status(500).json({ message: "Failed to fetch service extras" });
    }
  });

  app.put("/api/service-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { extras } = req.body;
      
      const results = [];
      for (const extra of extras) {
        const result = await storage.upsertServiceExtra({
          ...extra,
          providerId: profile.id,
          slotId,
        });
        results.push(result);
      }
      
      res.json(results);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error updating service extras:", error);
      res.status(500).json({ message: "Failed to update service extras" });
    }
  });

  // Custom Extras (user-defined, slot-scoped)
  app.get("/api/custom-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const extras = await storage.getCustomExtras(profile.id, slotId);
      res.json(extras);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching custom extras:", error);
      res.status(500).json({ message: "Failed to fetch custom extras" });
    }
  });

  app.post("/api/custom-extras", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const extra = await storage.createCustomExtra({
        ...req.body,
        providerId: profile.id,
        slotId,
      });
      res.status(201).json(extra);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error creating custom extra:", error);
      res.status(500).json({ message: "Failed to create custom extra" });
    }
  });

  app.patch("/api/custom-extras/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { id } = req.params;
      
      // Validate ownership + slot isolation
      const existing = await storage.getCustomExtra(id);
      if (!existing) {
        return res.status(404).json({ message: "Custom extra not found" });
      }
      if (existing.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (existing.slotId !== slotId) {
        return res.status(403).json({ message: "Cannot modify extra from another slot" });
      }
      
      const updated = await storage.updateCustomExtra(id, req.body);
      res.json(updated);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error updating custom extra:", error);
      res.status(500).json({ message: "Failed to update custom extra" });
    }
  });

  app.delete("/api/custom-extras/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { id } = req.params;
      
      // Validate ownership + slot isolation
      const existing = await storage.getCustomExtra(id);
      if (!existing) {
        return res.status(404).json({ message: "Custom extra not found" });
      }
      if (existing.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (existing.slotId !== slotId) {
        return res.status(403).json({ message: "Cannot delete extra from another slot" });
      }
      
      await storage.deleteCustomExtra(id);
      res.status(204).send();
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error deleting custom extra:", error);
      res.status(500).json({ message: "Failed to delete custom extra" });
    }
  });

  // Business Hours (slot-scoped)
  app.get("/api/business-hours", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const hours = await storage.getBusinessHours(profile.id, slotId);
      res.json(hours);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching business hours:", error);
      res.status(500).json({ message: "Failed to fetch business hours" });
    }
  });

  app.put("/api/business-hours", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { hours } = req.body;
      
      const hoursWithSlot = hours.map((h: any) => ({
        ...h,
        providerId: profile.id,
        slotId,
      }));

      const result = await storage.upsertBusinessHours(hoursWithSlot);
      res.json(result);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error updating business hours:", error);
      res.status(500).json({ message: "Failed to update business hours" });
    }
  });

  // Appointments (slot-scoped)
  app.get("/api/appointments", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      
      // Use Brussels timezone for date boundaries
      let startDate: Date;
      let endDate: Date;
      
      if (req.query.start && req.query.end) {
        // Convert Brussels local day boundaries to UTC
        // e.g., "2026-01-31" 00:00:00 Brussels → UTC
        const startParam = req.query.start as string;
        const endParam = req.query.end as string;
        startDate = fromZonedTime(`${startParam} 00:00:00`, BRUSSELS_TZ);
        endDate = fromZonedTime(`${endParam} 23:59:59`, BRUSSELS_TZ);
      } else {
        // Default to current week in Brussels timezone
        const now = new Date();
        startDate = startOfWeek(now, { weekStartsOn: 1 });
        endDate = endOfWeek(now, { weekStartsOn: 1 });
      }

      const appointments = await storage.getAppointments(profile.id, startDate, endDate, slotId);
      
      // Get services for each appointment (LEFT JOIN behavior - serviceId can be null)
      const services = await storage.getServices(profile.id);
      const serviceMap = new Map(services.map(s => [s.id, s]));
      
      const appointmentsWithService = appointments.map(apt => ({
        ...apt,
        service: apt.serviceId ? serviceMap.get(apt.serviceId) : undefined,
      }));

      res.json(appointmentsWithService);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching appointments:", error);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  app.get("/api/appointments/upcoming", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const appointments = await storage.getUpcomingAppointments(profile.id, slotId);
      
      const services = await storage.getServices(profile.id);
      const serviceMap = new Map(services.map(s => [s.id, s]));
      
      const appointmentsWithService = appointments.map(apt => ({
        ...apt,
        service: apt.serviceId ? serviceMap.get(apt.serviceId) : undefined,
      }));

      res.json(appointmentsWithService);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching upcoming appointments:", error);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  // Next 24h appointments endpoint (slot-scoped)
  app.get("/api/appointments/next24h", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const now = new Date();
      const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      // Get confirmed appointments in the next 24 hours for this slot
      const appointments = await storage.getAppointments(profile.id, now, in24h, slotId);
      const confirmedAppointments = appointments.filter(apt => apt.status === "confirmed");
      
      const services = await storage.getServices(profile.id);
      const serviceMap = new Map(services.map(s => [s.id, s]));
      
      const appointmentsWithService = confirmedAppointments.map(apt => ({
        ...apt,
        service: apt.serviceId ? serviceMap.get(apt.serviceId) : undefined,
      }));

      res.json(appointmentsWithService);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching next 24h appointments:", error);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  app.patch("/api/appointments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { id } = req.params;
      const appointment = await storage.getAppointment(id);
      
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      if (appointment.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // V1 slot isolation: verify appointment belongs to active slot
      if (appointment.slotId !== slotId) {
        return res.status(403).json({ message: "Wrong slot" });
      }

      // Only allow status updates (no providerId/slotId/appointmentDate changes)
      const validStatuses = ["confirmed", "cancelled", "completed", "no-show"];
      if (!req.body.status || !validStatuses.includes(req.body.status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const updated = await storage.updateAppointment(id, { status: req.body.status });
      res.json(updated);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error updating appointment:", error);
      res.status(500).json({ message: "Failed to update appointment" });
    }
  });

  // Blocked Slots (slot-scoped with Brussels timezone)
  app.get("/api/blocked-slots", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      
      // Use Brussels timezone for date boundaries (same as appointments)
      let startDate: Date;
      let endDate: Date;
      
      if (req.query.start && req.query.end) {
        const startParam = req.query.start as string;
        const endParam = req.query.end as string;
        startDate = fromZonedTime(`${startParam} 00:00:00`, BRUSSELS_TZ);
        endDate = fromZonedTime(`${endParam} 23:59:59`, BRUSSELS_TZ);
      } else {
        const now = new Date();
        startDate = startOfWeek(now, { weekStartsOn: 1 });
        endDate = endOfWeek(now, { weekStartsOn: 1 });
      }

      const slots = await storage.getBlockedSlots(profile.id, startDate, endDate, slotId);
      res.json(slots);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error fetching blocked slots:", error);
      res.status(500).json({ message: "Failed to fetch blocked slots" });
    }
  });

  app.post("/api/blocked-slots", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const data = insertBlockedSlotSchema.parse({ ...req.body, providerId: profile.id, slotId });
      const slot = await storage.createBlockedSlot(data);
      res.status(201).json(slot);
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error creating blocked slot:", error);
      res.status(500).json({ message: "Failed to create blocked slot" });
    }
  });

  app.delete("/api/blocked-slots/:id", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { id } = req.params;
      
      const blockedSlot = await storage.getBlockedSlot(id);
      
      if (!blockedSlot) {
        return res.status(404).json({ message: "Blocked slot not found" });
      }
      if (blockedSlot.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (blockedSlot.slotId !== slotId) {
        return res.status(403).json({ message: "Cannot delete blocked slot from another slot" });
      }

      await storage.deleteBlockedSlot(id);
      res.status(204).send();
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
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

  // Helper: validate slotId belongs to provider
  async function validateSlotOwnership(profile: any, slotId: string) {
    const slot = await storage.getSlot(slotId);
    if (!slot) return null;
    if (slot.providerId !== profile.id) return null;
    return slot;
  }

  // WhatsApp (slot-scoped: all endpoints require slotId)
  app.get("/api/whatsapp/status", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = req.query.slotId as string;
      if (!slotId) return res.status(400).json({ message: "slotId required" });
      
      const slot = await validateSlotOwnership(profile, slotId);
      if (!slot) return res.status(403).json({ message: "Slot not found or forbidden" });
      
      await whatsappManager.initSession(profile.id, slotId);
      
      const status = whatsappManager.getStatus(profile.id, slotId);
      res.json(status);
    } catch (error) {
      console.error("Error fetching WhatsApp status:", error);
      res.status(500).json({ message: "Failed to fetch WhatsApp status" });
    }
  });

  app.post("/api/whatsapp/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = req.body.slotId as string;
      if (!slotId) return res.status(400).json({ message: "slotId required" });
      
      const slot = await validateSlotOwnership(profile, slotId);
      if (!slot) return res.status(403).json({ message: "Slot not found or forbidden" });
      
      await whatsappManager.disconnect(profile.id, slotId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting WhatsApp:", error);
      res.status(500).json({ message: "Failed to disconnect WhatsApp" });
    }
  });

  app.post("/api/whatsapp/refresh-qr", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = req.body.slotId as string;
      if (!slotId) return res.status(400).json({ message: "slotId required" });
      
      const slot = await validateSlotOwnership(profile, slotId);
      if (!slot) return res.status(403).json({ message: "Slot not found or forbidden" });
      
      await whatsappManager.refreshQR(profile.id, slotId);
      const status = whatsappManager.getStatus(profile.id, slotId);
      res.json(status);
    } catch (error) {
      console.error("Error refreshing QR code:", error);
      res.status(500).json({ message: "Failed to refresh QR code" });
    }
  });

  app.post("/api/whatsapp/force-reconnect", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = req.body.slotId as string;
      if (!slotId) return res.status(400).json({ message: "slotId required" });
      
      const slot = await validateSlotOwnership(profile, slotId);
      if (!slot) return res.status(403).json({ message: "Slot not found or forbidden" });
      
      await whatsappManager.forceReconnect(profile.id, slotId);
      const status = whatsappManager.getStatus(profile.id, slotId);
      res.json(status);
    } catch (error) {
      console.error("Error force reconnecting WhatsApp:", error);
      res.status(500).json({ message: "Failed to force reconnect WhatsApp" });
    }
  });

  // QR Code as base64 image
  app.get("/api/whatsapp/qr", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = req.query.slotId as string;
      if (!slotId) return res.status(400).json({ message: "slotId required" });
      
      const slot = await validateSlotOwnership(profile, slotId);
      if (!slot) return res.status(403).json({ message: "Slot not found or forbidden" });
      
      const status = whatsappManager.getStatus(profile.id, slotId);
      
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

  // Availability Mode
  app.get("/api/provider/availability-mode", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      res.json({ mode: profile.availabilityMode || "active" });
    } catch (error) {
      console.error("Error fetching availability mode:", error);
      res.status(500).json({ message: "Failed to fetch availability mode" });
    }
  });

  app.patch("/api/provider/availability-mode", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { mode } = req.body;
      
      if (!["active", "away", "ghost"].includes(mode)) {
        return res.status(400).json({ message: "Invalid mode. Must be 'active', 'away', or 'ghost'" });
      }
      
      const updated = await storage.updateProviderProfile(profile.id, { availabilityMode: mode });
      res.json({ mode: updated?.availabilityMode });
    } catch (error) {
      console.error("Error updating availability mode:", error);
      res.status(500).json({ message: "Failed to update availability mode" });
    }
  });

  // No-show from Agenda (sends warning message + increments counter)
  app.post("/api/appointments/:id/noshow", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const slotId = await getActiveSlotId(req, profile.id);
      const { id } = req.params;
      const appointment = await storage.getAppointment(id);
      
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      if (appointment.providerId !== profile.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // V1 slot isolation: verify appointment belongs to active slot
      if (appointment.slotId !== slotId) {
        return res.status(403).json({ message: "Wrong slot" });
      }

      await storage.updateAppointment(id, { status: "no-show" });
      
      const reliability = await storage.incrementNoShow(appointment.clientPhone, profile.id);
      const noShowCount = reliability.noShowTotal || 1;
      
      let blocked = false;
      
      if (noShowCount >= 2) {
        await storage.addToBlacklist({
          phone: appointment.clientPhone,
          reason: `auto-block: ${noShowCount} no-shows`,
          reportedBy: profile.id,
        });
        await whatsappManager.sendNoShowBlock(profile.id, slotId, appointment.clientPhone);
        blocked = true;
      } else {
        await whatsappManager.sendNoShowWarning(profile.id, slotId, appointment.clientPhone);
      }
      
      res.json({ 
        success: true, 
        noShowTotal: noShowCount,
        blocked,
        message: blocked 
          ? "No-show marked – client blocked permanently" 
          : "No-show marked and warning sent to client"
      });
    } catch (error: any) {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error marking no-show:", error);
      res.status(500).json({ message: "Failed to mark no-show" });
    }
  });

  // Safety Blacklist - Report dangerous client
  app.post("/api/safety-blacklist", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const { phone, reason } = req.body;
      
      if (!phone) {
        return res.status(400).json({ message: "Phone number is required" });
      }
      
      const entry = await storage.reportDangerousClient(phone, profile.id, reason || "danger");
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error reporting dangerous client:", error);
      res.status(500).json({ message: "Failed to report dangerous client" });
    }
  });

  // Dashboard Stats with dangerous clients count
  app.get("/api/dashboard/extended-stats", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const stats = await storage.getDashboardStats(profile.id);
      const dangerousClientsFiltered = await storage.getDangerousClientsFilteredCount();
      
      res.json({
        ...stats,
        dangerousClientsFiltered,
      });
    } catch (error) {
      console.error("Error fetching extended stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Stripe Customer Portal Session
  app.post("/api/stripe/customer-portal", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      
      if (!profile.stripeCustomerId) {
        return res.status(400).json({ message: "Aucun abonnement Stripe associe" });
      }

      const stripe = await getUncachableStripeClient();
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const returnUrl = `${protocol}://${host}/abonnement`;

      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripeCustomerId,
        return_url: returnUrl,
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Error creating customer portal session:", error);
      res.status(500).json({ message: "Erreur lors de la creation de la session" });
    }
  });

  // Get available subscription plans
  app.get("/api/stripe/plans", async (_req, res) => {
    try {
      const plans = Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        price: plan.price / 100, // Convert cents to euros
        slots: plan.slots,
        available: !!plan.priceId,
      }));
      res.json(plans);
    } catch (error) {
      console.error("Error fetching plans:", error);
      res.status(500).json({ message: "Failed to fetch plans" });
    }
  });

  // Stripe Checkout Session - Create subscription with plan selection
  app.post("/api/stripe/create-checkout-session", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await getOrCreateProviderProfile(req);
      const stripe = await getUncachableStripeClient();
      
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const baseUrl = `${protocol}://${host}`;

      const selectedPlan = req.body.plan || 'solo';
      const priceId = getPriceIdForPlan(selectedPlan);
      const maxSlots = getMaxSlotsByPlan(selectedPlan);
      
      if (!priceId) {
        console.error(`[Stripe] No price ID configured for plan: ${selectedPlan}`);
        return res.status(400).json({ message: `Plan "${selectedPlan}" non configure. Contactez le support.` });
      }

      let customerId = profile.stripeCustomerId;
      
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user?.email,
          metadata: {
            providerId: profile.id,
            userId: profile.userId,
          },
        });
        customerId = customer.id;
        
        await storage.updateProviderProfile(profile.id, {
          stripeCustomerId: customerId,
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${baseUrl}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}&plan=${selectedPlan}`,
        cancel_url: `${baseUrl}/abonnement?cancelled=true`,
        metadata: {
          providerId: profile.id,
          plan: selectedPlan,
          maxSlots: String(maxSlots),
        },
      });

      console.log(`[Stripe] Checkout session created: plan=${selectedPlan}, priceId=${priceId}, maxSlots=${maxSlots}`);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("[Stripe] Error creating checkout session:", error?.message || error);
      if (error?.type === 'StripeInvalidRequestError') {
        console.error("[Stripe] Stripe details:", error?.raw?.message);
      }
      res.status(500).json({ message: "Erreur lors de la creation de la session de paiement. Verifiez la configuration Stripe." });
    }
  });

  // Stripe Success - Handle successful payment redirect
  app.get("/api/stripe/success", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      const plan = (req.query.plan as string) || 'solo';
      
      if (!sessionId) {
        return res.redirect("/abonnement?error=missing_session");
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status === 'paid' && session.metadata?.providerId) {
        const maxSlots = getMaxSlotsByPlan(plan);
        await storage.updateProviderProfile(session.metadata.providerId, {
          subscriptionStatus: 'active',
          maxSlots: maxSlots,
        });
        
        // Update user subscription plan
        const profile = await storage.getProviderProfileById(session.metadata.providerId);
        if (profile) {
          await storage.updateUserSubscriptionPlan(profile.userId, plan);
        }
      }

      res.redirect("/abonnement?success=true");
    } catch (error) {
      console.error("Error handling success redirect:", error);
      res.redirect("/abonnement?error=payment_verification_failed");
    }
  });

  // ==================== ADMIN ROUTES ====================
  
  // Get all users with their profiles and stats
  app.get("/api/admin/users", isAdmin, async (req: any, res) => {
    try {
      const users = await storage.getAllUsersWithProfiles();
      res.json(users);
    } catch (error) {
      console.error("Error fetching admin users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Reset user password (admin action)
  app.post("/api/admin/users/:userId/reset-password", isAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;
      
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
      }
      
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(userId, passwordHash);
      
      // Log activity
      await storage.logActivity("ADMIN_PASSWORD_RESET", `Password reset for user ${userId}`, { 
        targetUserId: userId,
        adminId: req.user?.id 
      });
      
      res.json({ success: true, message: "Mot de passe réinitialisé avec succès" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Erreur lors de la réinitialisation" });
    }
  });

  // Force activate subscription (admin action)
  app.post("/api/admin/users/:userId/force-activate", isAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      
      await storage.forceActivateSubscription(userId);
      
      // Log activity
      await storage.logActivity("ADMIN_FORCE_ACTIVATE", `Subscription force activated for user ${userId}`, { 
        targetUserId: userId,
        adminId: req.user?.id 
      });
      
      res.json({ success: true, message: "Abonnement activé avec succès" });
    } catch (error) {
      console.error("Error force activating:", error);
      res.status(500).json({ message: "Erreur lors de l'activation" });
    }
  });

  // Deactivate subscription (admin action)
  app.post("/api/admin/users/:userId/deactivate-subscription", isAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      
      await storage.deactivateSubscription(userId);
      
      // Log activity
      await storage.logActivity("ADMIN_DEACTIVATE_SUBSCRIPTION", `Subscription deactivated for user ${userId}`, { 
        targetUserId: userId,
        adminId: req.user?.id 
      });
      
      res.json({ success: true, message: "Abonnement désactivé avec succès" });
    } catch (error) {
      console.error("Error deactivating subscription:", error);
      res.status(500).json({ message: "Erreur lors de la désactivation" });
    }
  });

  // Delete user and all related data (admin action)
  app.delete("/api/admin/users/:userId", isAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      
      // Get user email before deletion for logging
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }
      
      await storage.deleteUserCascade(userId);
      
      // Log activity
      await storage.logActivity("ADMIN_USER_DELETED", `User ${user.email} deleted`, { 
        deletedEmail: user.email,
        adminId: req.user?.id 
      });
      
      res.json({ success: true, message: "Utilisateur supprimé avec succès" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Erreur lors de la suppression" });
    }
  });

  // Get admin platform statistics
  app.get("/api/admin/stats", isAdmin, async (req: any, res) => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ message: "Failed to fetch admin stats" });
    }
  });

  // Get activity logs
  app.get("/api/admin/activity-logs", isAdmin, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  // Emergency admin password reset via token
  app.post("/api/admin/emergency-reset", async (req, res) => {
    try {
      const { token, email, newPassword } = req.body;
      
      const adminResetToken = process.env.ADMIN_RESET_TOKEN;
      if (!adminResetToken) {
        return res.status(403).json({ message: "Emergency reset not configured" });
      }
      
      if (token !== adminResetToken) {
        return res.status(403).json({ message: "Invalid reset token" });
      }
      
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });
      }
      
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await storage.resetAdminPasswordByEmail(email, passwordHash);
      
      // Log activity
      await storage.logActivity("EMERGENCY_ADMIN_RESET", `Emergency password reset for ${email}`, { 
        email 
      });
      
      res.json({ success: true, message: "Mot de passe admin réinitialisé" });
    } catch (error) {
      console.error("Error in emergency reset:", error);
      res.status(500).json({ message: "Erreur lors de la réinitialisation" });
    }
  });

  // Check if current user is admin
  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
    res.json({ isAdmin: req.user?.role === "ADMIN" });
  });

  return httpServer;
}
