import { 
  services, 
  businessHours, 
  appointments, 
  blockedSlots, 
  blacklist, 
  messageLog,
  providerProfiles,
  clientReliability,
  providerBlocks,
  noShowReports,
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
  type MessageLogEntry,
  type ProviderProfile,
  type InsertProviderProfile,
  type ClientReliability,
  type ProviderBlock,
  type NoShowReport,
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
  
  // Message Log
  getMessages(providerId: string, limit?: number): Promise<MessageLogEntry[]>;
  logMessage(message: { providerId: string; clientPhone: string; direction: string; content: string }): Promise<MessageLogEntry>;
  
  // Stats
  getDashboardStats(providerId: string): Promise<{
    todayAppointments: number;
    weekAppointments: number;
    completedThisMonth: number;
    noShowsThisMonth: number;
    totalClients: number;
    messagesThisWeek: number;
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

  // Message Log
  async getMessages(providerId: string, limit = 100): Promise<MessageLogEntry[]> {
    return db.select().from(messageLog)
      .where(eq(messageLog.providerId, providerId))
      .orderBy(desc(messageLog.createdAt))
      .limit(limit);
  }

  async logMessage(message: { providerId: string; clientPhone: string; direction: string; content: string }): Promise<MessageLogEntry> {
    const [result] = await db.insert(messageLog).values(message).returning();
    return result;
  }

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

    const [messagesResult] = await db.select({ count: count() }).from(messageLog).where(
      and(
        eq(messageLog.providerId, providerId),
        gte(messageLog.createdAt, startOfWeek),
        lte(messageLog.createdAt, endOfWeek)
      )
    );

    return {
      todayAppointments: todayResult?.count || 0,
      weekAppointments: weekResult?.count || 0,
      completedThisMonth: completedResult?.count || 0,
      noShowsThisMonth: noShowResult?.count || 0,
      totalClients: clientsResult?.length || 0,
      messagesThisWeek: messagesResult?.count || 0,
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
}

export const storage = new DatabaseStorage();
