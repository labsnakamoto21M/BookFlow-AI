import { 
  services, 
  businessHours, 
  appointments, 
  blockedSlots, 
  blacklist, 
  providerProfiles,
  clientReliability,
  providerBlocks,
  noShowReports,
  basePrices,
  serviceExtras,
  customExtras,
  safetyBlacklist,
  type Service, 
  type InsertService,
  type BusinessHours,
  type InsertBusinessHours,
  type Appointment,
  type InsertAppointment,
  type BlockedSlot,
  type InsertBlockedSlot,
  type BlacklistEntry,
  type InsertBlacklist,
  type ProviderProfile,
  type InsertProviderProfile,
  type ClientReliability,
  type ProviderBlock,
  type NoShowReport,
  type BasePrice,
  type InsertBasePrice,
  type ServiceExtra,
  type InsertServiceExtra,
  type CustomExtra,
  type InsertCustomExtra,
  type SafetyBlacklistEntry,
  type InsertSafetyBlacklist,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, sql, desc, count } from "drizzle-orm";

export interface IStorage {
  // Provider Profile
  getProviderProfile(userId: string): Promise<ProviderProfile | undefined>;
  getProviderProfileById(id: string): Promise<ProviderProfile | undefined>;
  upsertProviderProfile(profile: InsertProviderProfile): Promise<ProviderProfile>;
  updateProviderProfile(id: string, updates: Partial<InsertProviderProfile>): Promise<ProviderProfile | undefined>;
  
  // Services
  getServices(providerId: string): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: string, updates: Partial<InsertService>): Promise<Service | undefined>;
  deleteService(id: string): Promise<void>;
  
  // Business Hours
  getBusinessHours(providerId: string): Promise<BusinessHours[]>;
  upsertBusinessHours(hours: InsertBusinessHours[]): Promise<BusinessHours[]>;
  
  // Appointments
  getAppointments(providerId: string, startDate: Date, endDate: Date): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment | undefined>;
  getUpcomingAppointments(providerId: string, limit?: number): Promise<Appointment[]>;
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  updateAppointment(id: string, updates: Partial<InsertAppointment>): Promise<Appointment | undefined>;
  getAppointmentsNeedingReminder(): Promise<Appointment[]>;
  
  // Blocked Slots
  getBlockedSlots(providerId: string, startDate: Date, endDate: Date): Promise<BlockedSlot[]>;
  getBlockedSlot(id: string): Promise<BlockedSlot | undefined>;
  createBlockedSlot(slot: InsertBlockedSlot): Promise<BlockedSlot>;
  deleteBlockedSlot(id: string): Promise<void>;
  
  // Blacklist
  getBlacklist(): Promise<BlacklistEntry[]>;
  isBlacklisted(phone: string): Promise<BlacklistEntry | undefined>;
  addToBlacklist(entry: InsertBlacklist): Promise<BlacklistEntry>;
  
  // GDPR: Message logging removed - no content stored
  
  // Stats
  getDashboardStats(providerId: string): Promise<{
    todayAppointments: number;
    weekAppointments: number;
    completedThisMonth: number;
    noShowsThisMonth: number;
    totalClients: number;
  }>;
  
  // Client Reliability (No-Show Tracking)
  getClientReliability(phone: string): Promise<ClientReliability | undefined>;
  incrementNoShow(phone: string, providerId: string): Promise<ClientReliability>;
  
  // Provider Blocks (Personal Blocklist)
  getProviderBlocks(providerId: string): Promise<ProviderBlock[]>;
  blockClient(providerId: string, phone: string, reason?: string): Promise<ProviderBlock>;
  unblockClient(providerId: string, phone: string): Promise<void>;
  isBlockedByProvider(providerId: string, phone: string): Promise<boolean>;
  
  // No-Show Reports
  getNoShowReports(providerId: string): Promise<NoShowReport[]>;
  
  // Base Prices (duration-based pricing)
  getBasePrices(providerId: string): Promise<BasePrice[]>;
  upsertBasePrice(price: InsertBasePrice): Promise<BasePrice>;
  updateBasePrice(id: string, updates: Partial<InsertBasePrice>): Promise<BasePrice | undefined>;
  
  // Service Extras (predefined extras)
  getServiceExtras(providerId: string): Promise<ServiceExtra[]>;
  upsertServiceExtra(extra: InsertServiceExtra): Promise<ServiceExtra>;
  updateServiceExtra(id: string, updates: Partial<InsertServiceExtra>): Promise<ServiceExtra | undefined>;
  initializeDefaultExtras(providerId: string): Promise<void>;
  
  // Custom Extras (user-defined)
  getCustomExtras(providerId: string): Promise<CustomExtra[]>;
  createCustomExtra(extra: InsertCustomExtra): Promise<CustomExtra>;
  updateCustomExtra(id: string, updates: Partial<InsertCustomExtra>): Promise<CustomExtra | undefined>;
  deleteCustomExtra(id: string): Promise<void>;
  
  // Safety Blacklist (dangerous clients)
  getSafetyBlacklist(): Promise<SafetyBlacklistEntry[]>;
  getSafetyBlacklistByPhone(phone: string): Promise<SafetyBlacklistEntry | undefined>;
  reportDangerousClient(phone: string, reportedBy: string, reason?: string): Promise<SafetyBlacklistEntry>;
  isDangerousClient(phone: string): Promise<boolean>;
  getDangerousClientsFilteredCount(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // Provider Profile
  async getProviderProfile(userId: string): Promise<ProviderProfile | undefined> {
    const [profile] = await db.select().from(providerProfiles).where(eq(providerProfiles.userId, userId));
    return profile;
  }

  async getProviderProfileById(id: string): Promise<ProviderProfile | undefined> {
    const [profile] = await db.select().from(providerProfiles).where(eq(providerProfiles.id, id));
    return profile;
  }

  async upsertProviderProfile(profile: InsertProviderProfile): Promise<ProviderProfile> {
    const [result] = await db
      .insert(providerProfiles)
      .values(profile)
      .onConflictDoUpdate({
        target: providerProfiles.userId,
        set: { ...profile, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async updateProviderProfile(id: string, updates: Partial<InsertProviderProfile>): Promise<ProviderProfile | undefined> {
    const [result] = await db
      .update(providerProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(providerProfiles.id, id))
      .returning();
    return result;
  }

  // Services
  async getServices(providerId: string): Promise<Service[]> {
    return db.select().from(services).where(eq(services.providerId, providerId));
  }

  async getService(id: string): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }

  async createService(service: InsertService): Promise<Service> {
    const [result] = await db.insert(services).values(service).returning();
    return result;
  }

  async updateService(id: string, updates: Partial<InsertService>): Promise<Service | undefined> {
    const [result] = await db.update(services).set(updates).where(eq(services.id, id)).returning();
    return result;
  }

  async deleteService(id: string): Promise<void> {
    await db.delete(services).where(eq(services.id, id));
  }

  // Business Hours
  async getBusinessHours(providerId: string): Promise<BusinessHours[]> {
    return db.select().from(businessHours).where(eq(businessHours.providerId, providerId));
  }

  async upsertBusinessHours(hours: InsertBusinessHours[]): Promise<BusinessHours[]> {
    if (hours.length === 0) return [];
    
    const providerId = hours[0].providerId;
    await db.delete(businessHours).where(eq(businessHours.providerId, providerId));
    
    const results = await db.insert(businessHours).values(hours).returning();
    return results;
  }

  // Appointments
  async getAppointments(providerId: string, startDate: Date, endDate: Date): Promise<Appointment[]> {
    return db.select().from(appointments).where(
      and(
        eq(appointments.providerId, providerId),
        gte(appointments.appointmentDate, startDate),
        lte(appointments.appointmentDate, endDate)
      )
    );
  }

  async getAppointment(id: string): Promise<Appointment | undefined> {
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, id));
    return apt;
  }

  async getUpcomingAppointments(providerId: string, limit = 10): Promise<Appointment[]> {
    return db.select().from(appointments).where(
      and(
        eq(appointments.providerId, providerId),
        gte(appointments.appointmentDate, new Date()),
        eq(appointments.status, "confirmed")
      )
    ).orderBy(appointments.appointmentDate).limit(limit);
  }

  async createAppointment(appointment: InsertAppointment): Promise<Appointment> {
    const [result] = await db.insert(appointments).values(appointment).returning();
    return result;
  }

  async updateAppointment(id: string, updates: Partial<InsertAppointment>): Promise<Appointment | undefined> {
    const [result] = await db.update(appointments).set(updates).where(eq(appointments.id, id)).returning();
    return result;
  }

  async getAppointmentsNeedingReminder(): Promise<Appointment[]> {
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    
    return db.select().from(appointments).where(
      and(
        eq(appointments.status, "confirmed"),
        eq(appointments.reminderSent, false),
        gte(appointments.appointmentDate, oneHourFromNow),
        lte(appointments.appointmentDate, twoHoursFromNow)
      )
    );
  }

  // Blocked Slots
  async getBlockedSlots(providerId: string, startDate: Date, endDate: Date): Promise<BlockedSlot[]> {
    return db.select().from(blockedSlots).where(
      and(
        eq(blockedSlots.providerId, providerId),
        gte(blockedSlots.startTime, startDate),
        lte(blockedSlots.endTime, endDate)
      )
    );
  }

  async getBlockedSlot(id: string): Promise<BlockedSlot | undefined> {
    const [slot] = await db.select().from(blockedSlots).where(eq(blockedSlots.id, id));
    return slot;
  }

  async createBlockedSlot(slot: InsertBlockedSlot): Promise<BlockedSlot> {
    const [result] = await db.insert(blockedSlots).values(slot).returning();
    return result;
  }

  async deleteBlockedSlot(id: string): Promise<void> {
    await db.delete(blockedSlots).where(eq(blockedSlots.id, id));
  }

  // Blacklist
  async getBlacklist(): Promise<BlacklistEntry[]> {
    return db.select().from(blacklist).orderBy(desc(blacklist.createdAt));
  }

  async isBlacklisted(phone: string): Promise<BlacklistEntry | undefined> {
    const normalizedPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
    const [entry] = await db.select().from(blacklist).where(
      sql`REPLACE(REPLACE(${blacklist.phone}, ' ', ''), '-', '') = ${normalizedPhone}`
    );
    return entry;
  }

  async addToBlacklist(entry: InsertBlacklist): Promise<BlacklistEntry> {
    const existing = await this.isBlacklisted(entry.phone);
    if (existing) {
      const [updated] = await db
        .update(blacklist)
        .set({ reportCount: (existing.reportCount || 1) + 1 })
        .where(eq(blacklist.id, existing.id))
        .returning();
      return updated;
    }
    const [result] = await db.insert(blacklist).values(entry).returning();
    return result;
  }

  // GDPR: Message logging functions removed - no content stored

  // Stats
  async getDashboardStats(providerId: string) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [todayResult] = await db.select({ count: count() }).from(appointments).where(
      and(
        eq(appointments.providerId, providerId),
        gte(appointments.appointmentDate, startOfToday),
        lte(appointments.appointmentDate, endOfToday),
        eq(appointments.status, "confirmed")
      )
    );

    const [weekResult] = await db.select({ count: count() }).from(appointments).where(
      and(
        eq(appointments.providerId, providerId),
        gte(appointments.appointmentDate, startOfWeek),
        lte(appointments.appointmentDate, endOfWeek),
        eq(appointments.status, "confirmed")
      )
    );

    const [completedResult] = await db.select({ count: count() }).from(appointments).where(
      and(
        eq(appointments.providerId, providerId),
        gte(appointments.appointmentDate, startOfMonth),
        lte(appointments.appointmentDate, endOfMonth),
        eq(appointments.status, "completed")
      )
    );

    const [noShowResult] = await db.select({ count: count() }).from(appointments).where(
      and(
        eq(appointments.providerId, providerId),
        gte(appointments.appointmentDate, startOfMonth),
        lte(appointments.appointmentDate, endOfMonth),
        eq(appointments.status, "no-show")
      )
    );

    const clientsResult = await db.selectDistinct({ phone: appointments.clientPhone }).from(appointments).where(
      eq(appointments.providerId, providerId)
    );

    // GDPR: messagesThisWeek removed - no message logging

    return {
      todayAppointments: todayResult?.count || 0,
      weekAppointments: weekResult?.count || 0,
      completedThisMonth: completedResult?.count || 0,
      noShowsThisMonth: noShowResult?.count || 0,
      totalClients: clientsResult?.length || 0,
    };
  }

  // Client Reliability (No-Show Tracking)
  async getClientReliability(phone: string): Promise<ClientReliability | undefined> {
    const normalizedPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
    const [entry] = await db.select().from(clientReliability).where(
      sql`REPLACE(REPLACE(${clientReliability.phone}, ' ', ''), '-', '') = ${normalizedPhone}`
    );
    return entry;
  }

  async incrementNoShow(phone: string, providerId: string): Promise<ClientReliability> {
    const normalizedPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
    
    // Create no-show report
    await db.insert(noShowReports).values({ providerId, phone: normalizedPhone });
    
    // Check if client exists in reliability table
    const existing = await this.getClientReliability(normalizedPhone);
    
    if (existing) {
      const [updated] = await db
        .update(clientReliability)
        .set({ 
          noShowTotal: (existing.noShowTotal || 0) + 1,
          lastNoShowDate: new Date(),
          updatedAt: new Date()
        })
        .where(eq(clientReliability.id, existing.id))
        .returning();
      return updated;
    }
    
    // Create new entry
    const [result] = await db.insert(clientReliability).values({
      phone: normalizedPhone,
      noShowTotal: 1,
      lastNoShowDate: new Date(),
    }).returning();
    return result;
  }

  // Provider Blocks (Personal Blocklist)
  async getProviderBlocks(providerId: string): Promise<ProviderBlock[]> {
    return db.select().from(providerBlocks)
      .where(eq(providerBlocks.providerId, providerId))
      .orderBy(desc(providerBlocks.blockedAt));
  }

  async blockClient(providerId: string, phone: string, reason?: string): Promise<ProviderBlock> {
    const normalizedPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
    
    // Check if already blocked
    const [existing] = await db.select().from(providerBlocks).where(
      and(
        eq(providerBlocks.providerId, providerId),
        sql`REPLACE(REPLACE(${providerBlocks.phone}, ' ', ''), '-', '') = ${normalizedPhone}`
      )
    );
    
    if (existing) {
      return existing;
    }
    
    const [result] = await db.insert(providerBlocks).values({
      providerId,
      phone: normalizedPhone,
      reason,
    }).returning();
    return result;
  }

  async unblockClient(providerId: string, phone: string): Promise<void> {
    const normalizedPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
    await db.delete(providerBlocks).where(
      and(
        eq(providerBlocks.providerId, providerId),
        sql`REPLACE(REPLACE(${providerBlocks.phone}, ' ', ''), '-', '') = ${normalizedPhone}`
      )
    );
  }

  async isBlockedByProvider(providerId: string, phone: string): Promise<boolean> {
    const normalizedPhone = phone.replace(/\s+/g, "").replace(/-/g, "");
    const [entry] = await db.select().from(providerBlocks).where(
      and(
        eq(providerBlocks.providerId, providerId),
        sql`REPLACE(REPLACE(${providerBlocks.phone}, ' ', ''), '-', '') = ${normalizedPhone}`
      )
    );
    return !!entry;
  }

  // No-Show Reports
  async getNoShowReports(providerId: string): Promise<NoShowReport[]> {
    return db.select().from(noShowReports)
      .where(eq(noShowReports.providerId, providerId))
      .orderBy(desc(noShowReports.reportedAt));
  }
  
  // Base Prices
  async getBasePrices(providerId: string): Promise<BasePrice[]> {
    return db.select().from(basePrices)
      .where(eq(basePrices.providerId, providerId))
      .orderBy(basePrices.duration);
  }
  
  async upsertBasePrice(price: InsertBasePrice): Promise<BasePrice> {
    // Check if exists
    const [existing] = await db.select().from(basePrices).where(
      and(
        eq(basePrices.providerId, price.providerId),
        eq(basePrices.duration, price.duration)
      )
    );
    
    if (existing) {
      const [result] = await db.update(basePrices)
        .set(price)
        .where(eq(basePrices.id, existing.id))
        .returning();
      return result;
    }
    
    const [result] = await db.insert(basePrices).values(price).returning();
    return result;
  }
  
  async updateBasePrice(id: string, updates: Partial<InsertBasePrice>): Promise<BasePrice | undefined> {
    const [result] = await db.update(basePrices)
      .set(updates)
      .where(eq(basePrices.id, id))
      .returning();
    return result;
  }
  
  // Service Extras (predefined)
  async getServiceExtras(providerId: string): Promise<ServiceExtra[]> {
    return db.select().from(serviceExtras)
      .where(eq(serviceExtras.providerId, providerId));
  }
  
  async upsertServiceExtra(extra: InsertServiceExtra): Promise<ServiceExtra> {
    const [existing] = await db.select().from(serviceExtras).where(
      and(
        eq(serviceExtras.providerId, extra.providerId),
        eq(serviceExtras.extraType, extra.extraType)
      )
    );
    
    if (existing) {
      const [result] = await db.update(serviceExtras)
        .set(extra)
        .where(eq(serviceExtras.id, existing.id))
        .returning();
      return result;
    }
    
    const [result] = await db.insert(serviceExtras).values(extra).returning();
    return result;
  }
  
  async updateServiceExtra(id: string, updates: Partial<InsertServiceExtra>): Promise<ServiceExtra | undefined> {
    const [result] = await db.update(serviceExtras)
      .set(updates)
      .where(eq(serviceExtras.id, id))
      .returning();
    return result;
  }
  
  async initializeDefaultExtras(providerId: string): Promise<void> {
    const defaultExtras = [
      "Anal",
      "Fellatio without condom",
      "Sex without condom",
      "Anilingus (giving)",
      "Swallow sperm",
      "Ejaculate on face",
      "Goldenshower on you",
      "Goldenshower on me",
      "Prostate massage",
      "French Kiss"
    ];
    
    for (const extraType of defaultExtras) {
      const [existing] = await db.select().from(serviceExtras).where(
        and(
          eq(serviceExtras.providerId, providerId),
          eq(serviceExtras.extraType, extraType)
        )
      );
      
      if (!existing) {
        await db.insert(serviceExtras).values({
          providerId,
          extraType,
          active: false,
          price: 0,
        });
      }
    }
  }
  
  // Custom Extras
  async getCustomExtras(providerId: string): Promise<CustomExtra[]> {
    return db.select().from(customExtras)
      .where(eq(customExtras.providerId, providerId))
      .orderBy(desc(customExtras.createdAt));
  }
  
  async createCustomExtra(extra: InsertCustomExtra): Promise<CustomExtra> {
    const [result] = await db.insert(customExtras).values(extra).returning();
    return result;
  }
  
  async updateCustomExtra(id: string, updates: Partial<InsertCustomExtra>): Promise<CustomExtra | undefined> {
    const [result] = await db.update(customExtras)
      .set(updates)
      .where(eq(customExtras.id, id))
      .returning();
    return result;
  }
  
  async deleteCustomExtra(id: string): Promise<void> {
    await db.delete(customExtras).where(eq(customExtras.id, id));
  }
  
  // Safety Blacklist
  async getSafetyBlacklist(): Promise<SafetyBlacklistEntry[]> {
    return db.select().from(safetyBlacklist).orderBy(desc(safetyBlacklist.createdAt));
  }
  
  async getSafetyBlacklistByPhone(phone: string): Promise<SafetyBlacklistEntry | undefined> {
    const normalizedPhone = phone.replace(/\D/g, '');
    const [entry] = await db.select().from(safetyBlacklist)
      .where(sql`replace(${safetyBlacklist.phone}, '+', '') LIKE '%' || ${normalizedPhone} || '%'`);
    return entry;
  }
  
  async reportDangerousClient(phone: string, reportedBy: string, reason: string = "danger"): Promise<SafetyBlacklistEntry> {
    const existing = await this.getSafetyBlacklistByPhone(phone);
    
    if (existing) {
      const [updated] = await db.update(safetyBlacklist)
        .set({ reportCount: (existing.reportCount || 1) + 1 })
        .where(eq(safetyBlacklist.id, existing.id))
        .returning();
      return updated;
    }
    
    const [result] = await db.insert(safetyBlacklist).values({
      phone,
      reportedBy,
      reason,
      reportCount: 1,
    }).returning();
    return result;
  }
  
  async isDangerousClient(phone: string): Promise<boolean> {
    const entry = await this.getSafetyBlacklistByPhone(phone);
    return entry !== undefined && (entry.reportCount || 0) >= 2;
  }
  
  async getDangerousClientsFilteredCount(): Promise<number> {
    const result = await db.select({ count: count() })
      .from(safetyBlacklist)
      .where(gte(safetyBlacklist.reportCount, 2));
    return result[0]?.count || 0;
  }
}

export const storage = new DatabaseStorage();
