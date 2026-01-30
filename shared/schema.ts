import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, time, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models
export * from "./models/auth";

// Re-export chat models for AI integrations
export * from "./models/chat";

// Provider Profiles - Extended user info for service providers
export const providerProfiles = pgTable("provider_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  businessName: text("business_name").notNull(),
  description: text("description"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  whatsappConnected: boolean("whatsapp_connected").default(false),
  whatsappSessionData: text("whatsapp_session_data"),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status").default("trial"),
  availabilityMode: text("availability_mode").default("active"), // active, away, ghost
  maxSlots: integer("max_slots").default(1), // Max slots based on subscription plan
  customInstructions: text("custom_instructions"), // AI bot personality and behavior instructions
  externalProfileUrl: text("external_profile_url"), // Link to external profile (photos, details)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Slots - Individual masseuses/agents for multi-account support
export const slots = pgTable("slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  name: text("name").notNull(), // Masseuse name
  phone: text("phone"), // WhatsApp phone number for this slot
  address: text("address"), // Address for this slot
  city: text("city"),
  availabilityMode: text("availability_mode").default("active"), // active, away, ghost
  whatsappConnected: boolean("whatsapp_connected").default(false),
  whatsappSessionData: text("whatsapp_session_data"),
  manualOverrideUntil: timestamp("manual_override_until"), // Pause bot until this time (24h manual control)
  customInstructions: text("custom_instructions"), // AI bot personality and behavior instructions
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_slots_provider").on(table.providerId),
]);

// Legacy services table (kept for compatibility)
export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(), // in cents
  duration: integer("duration").notNull(), // in minutes
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Base prices by duration (Prive vs Escort) - now per slot
export const basePrices = pgTable("base_prices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  slotId: varchar("slot_id"), // Optional: if null, applies to provider default
  duration: integer("duration").notNull(), // in minutes: 15, 30, 45, 60, 90, 120
  pricePrivate: integer("price_private").default(0), // in cents
  priceEscort: integer("price_escort").default(0), // in cents
  active: boolean("active").default(true),
}, (table) => [
  index("idx_base_prices_provider").on(table.providerId),
  index("idx_base_prices_slot").on(table.slotId),
]);

// Predefined extras (fixed list)
export const serviceExtras = pgTable("service_extras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  extraType: text("extra_type").notNull(), // predefined type name
  active: boolean("active").default(false),
  price: integer("price").default(0), // supplement price in cents
}, (table) => [
  index("idx_service_extras_provider").on(table.providerId),
]);

// Custom extras (user-defined)
export const customExtras = pgTable("custom_extras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  name: text("name").notNull(),
  price: integer("price").default(0), // in cents
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_custom_extras_provider").on(table.providerId),
]);

// Business hours for providers - now per slot
export const businessHours = pgTable("business_hours", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  slotId: varchar("slot_id"), // Optional: if null, applies to provider default
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday, 6 = Saturday
  openTime: time("open_time").notNull(),
  closeTime: time("close_time").notNull(),
  isClosed: boolean("is_closed").default(false),
}, (table) => [
  index("idx_business_hours_slot").on(table.slotId),
]);

// Appointments - now per slot
export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  slotId: varchar("slot_id"), // Optional: links to specific masseuse
  serviceId: varchar("service_id"), // NULLABLE: bot can book without explicit service ID
  clientPhone: text("client_phone").notNull(),
  clientName: text("client_name"),
  appointmentDate: timestamp("appointment_date").notNull(),
  duration: integer("duration").notNull(), // in minutes
  status: text("status").default("confirmed"), // confirmed, cancelled, completed, no-show
  reminderSent: boolean("reminder_sent").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_appointments_provider").on(table.providerId),
  index("idx_appointments_slot").on(table.slotId),
  index("idx_appointments_date").on(table.appointmentDate),
]);

// Blocked time slots
export const blockedSlots = pgTable("blocked_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Shared blacklist for no-show clients
export const blacklist = pgTable("blacklist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: text("phone").notNull(),
  reportedBy: varchar("reported_by").notNull(), // provider who reported
  reason: text("reason"),
  reportCount: integer("report_count").default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_blacklist_phone").on(table.phone),
]);

// GDPR: messageLog table removed - no message content is stored
// The table still exists in the database but is no longer used

// Client reliability tracking (global no-show counter)
export const clientReliability = pgTable("client_reliability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: text("phone").notNull().unique(),
  noShowTotal: integer("no_show_total").default(0),
  lastNoShowDate: timestamp("last_no_show_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_client_reliability_phone").on(table.phone),
]);

// Provider-specific blocks (personal blocklist)
export const providerBlocks = pgTable("provider_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  phone: text("phone").notNull(),
  reason: text("reason"),
  blockedAt: timestamp("blocked_at").defaultNow(),
}, (table) => [
  index("idx_provider_blocks_provider").on(table.providerId),
  index("idx_provider_blocks_phone").on(table.phone),
]);

// No-show reports (track who reported whom)
export const noShowReports = pgTable("no_show_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  phone: text("phone").notNull(),
  reportedAt: timestamp("reported_at").defaultNow(),
}, (table) => [
  index("idx_no_show_reports_provider").on(table.providerId),
]);

// Safety blacklist for dangerous clients (shared across all providers)
export const safetyBlacklist = pgTable("safety_blacklist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: text("phone").notNull(),
  reportedBy: varchar("reported_by").notNull(), // provider who reported
  reason: text("reason").default("danger"), // danger, violence, threat
  reportCount: integer("report_count").default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_safety_blacklist_phone").on(table.phone),
]);

// Conversation sessions - Persistent state for WhatsApp bot conversations
export const conversationSessions = pgTable("conversation_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull(),
  clientPhone: text("client_phone").notNull(),
  serviceId: varchar("service_id"),
  sessionType: text("session_type"), // private, escort
  duration: integer("duration"), // in minutes
  basePrice: integer("base_price").default(0), // in cents
  extras: text("extras").array(), // array of extra names
  extrasTotal: integer("extras_total").default(0), // in cents
  chatHistory: jsonb("chat_history").default([]), // array of {role, content}
  slotMapping: jsonb("slot_mapping").default({}), // {1: "09:00", 2: "09:30", ...} for numbered slot selection
  detectedLanguage: text("detected_language").default("fr"), // detected client language
  lastUpdate: timestamp("last_update").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_conv_sessions_provider").on(table.providerId),
  index("idx_conv_sessions_phone").on(table.clientPhone),
]);

// Relations
export const providerProfilesRelations = relations(providerProfiles, ({ many }) => ({
  services: many(services),
  businessHours: many(businessHours),
  appointments: many(appointments),
  blockedSlots: many(blockedSlots),
  slots: many(slots),
}));

export const slotsRelations = relations(slots, ({ one, many }) => ({
  provider: one(providerProfiles, {
    fields: [slots.providerId],
    references: [providerProfiles.id],
  }),
  appointments: many(appointments),
  businessHours: many(businessHours),
  basePrices: many(basePrices),
}));

export const servicesRelations = relations(services, ({ one }) => ({
  provider: one(providerProfiles, {
    fields: [services.providerId],
    references: [providerProfiles.id],
  }),
}));

export const businessHoursRelations = relations(businessHours, ({ one }) => ({
  provider: one(providerProfiles, {
    fields: [businessHours.providerId],
    references: [providerProfiles.id],
  }),
  slot: one(slots, {
    fields: [businessHours.slotId],
    references: [slots.id],
  }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  provider: one(providerProfiles, {
    fields: [appointments.providerId],
    references: [providerProfiles.id],
  }),
  slot: one(slots, {
    fields: [appointments.slotId],
    references: [slots.id],
  }),
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
}));

// Insert schemas
export const insertProviderProfileSchema = createInsertSchema(providerProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
  createdAt: true,
});

export const insertBasePriceSchema = createInsertSchema(basePrices).omit({
  id: true,
});

export const insertServiceExtraSchema = createInsertSchema(serviceExtras).omit({
  id: true,
});

export const insertCustomExtraSchema = createInsertSchema(customExtras).omit({
  id: true,
  createdAt: true,
});

export const insertBusinessHoursSchema = createInsertSchema(businessHours).omit({
  id: true,
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
});

export const insertBlockedSlotSchema = createInsertSchema(blockedSlots).omit({
  id: true,
  createdAt: true,
});

export const insertBlacklistSchema = createInsertSchema(blacklist).omit({
  id: true,
  createdAt: true,
});

export const insertClientReliabilitySchema = createInsertSchema(clientReliability).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProviderBlockSchema = createInsertSchema(providerBlocks).omit({
  id: true,
  blockedAt: true,
});

export const insertNoShowReportSchema = createInsertSchema(noShowReports).omit({
  id: true,
  reportedAt: true,
});

export const insertSafetyBlacklistSchema = createInsertSchema(safetyBlacklist).omit({
  id: true,
  createdAt: true,
});

export const insertSlotSchema = createInsertSchema(slots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertConversationSessionSchema = createInsertSchema(conversationSessions).omit({
  id: true,
  createdAt: true,
});

// Types
export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type InsertProviderProfile = z.infer<typeof insertProviderProfileSchema>;

export type Slot = typeof slots.$inferSelect;
export type InsertSlot = z.infer<typeof insertSlotSchema>;

export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;

export type BasePrice = typeof basePrices.$inferSelect;
export type InsertBasePrice = z.infer<typeof insertBasePriceSchema>;

export type ServiceExtra = typeof serviceExtras.$inferSelect;
export type InsertServiceExtra = z.infer<typeof insertServiceExtraSchema>;

export type CustomExtra = typeof customExtras.$inferSelect;
export type InsertCustomExtra = z.infer<typeof insertCustomExtraSchema>;

export type BusinessHours = typeof businessHours.$inferSelect;
export type InsertBusinessHours = z.infer<typeof insertBusinessHoursSchema>;

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;

export type BlockedSlot = typeof blockedSlots.$inferSelect;
export type InsertBlockedSlot = z.infer<typeof insertBlockedSlotSchema>;

export type BlacklistEntry = typeof blacklist.$inferSelect;
export type InsertBlacklist = z.infer<typeof insertBlacklistSchema>;

// GDPR: MessageLogEntry type removed - no message content is stored

export type ClientReliability = typeof clientReliability.$inferSelect;
export type InsertClientReliability = z.infer<typeof insertClientReliabilitySchema>;

export type ProviderBlock = typeof providerBlocks.$inferSelect;
export type InsertProviderBlock = z.infer<typeof insertProviderBlockSchema>;

export type NoShowReport = typeof noShowReports.$inferSelect;
export type InsertNoShowReport = z.infer<typeof insertNoShowReportSchema>;

export type SafetyBlacklistEntry = typeof safetyBlacklist.$inferSelect;
export type InsertSafetyBlacklist = z.infer<typeof insertSafetyBlacklistSchema>;

export type ConversationSession = typeof conversationSessions.$inferSelect;
export type InsertConversationSession = z.infer<typeof insertConversationSessionSchema>;
