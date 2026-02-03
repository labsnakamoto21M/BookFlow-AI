import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  delay,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode";
import { storage } from "./storage";
import { format, addDays, startOfDay, endOfDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { toZonedTime, formatInTimeZone, fromZonedTime } from "date-fns-tz";

const BRUSSELS_TZ = "Europe/Brussels";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface WhatsAppSession {
  socket: WASocket | null;
  qrCode: string | null;
  connected: boolean;
  phoneNumber: string | null;
  providerId: string;
  slotId: string | null; // Resolved slot ID based on WhatsApp phone number
  createdAt: number;
  lastRestart: number;
}

// Phone normalization helper: strips spaces, dashes, parentheses, leading +, leading 00
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  // Remove all non-digit characters except leading + or 00
  let normalized = phone.replace(/[\s\-\(\)\.]/g, "");
  // Remove leading + or 00
  if (normalized.startsWith("+")) {
    normalized = normalized.substring(1);
  } else if (normalized.startsWith("00")) {
    normalized = normalized.substring(2);
  }
  return normalized;
}

interface ConversationState {
  type: "private" | "escort" | null;
  duration: number | null;
  basePrice: number;
  extras: string[];
  extrasTotal: number;
  lastUpdate: number;
  chatHistory: ChatMessage[];
  serviceId: string | null;
  slotMapping: Record<number, string>; // {1: "09:00", 2: "09:30", ...}
  detectedLanguage: string; // fr, en, es, nl, de, etc.
  lastBookingAt: number | null; // timestamp of last booking
  lastBookingAddress: string | null; // address used in confirmation
  lastBookingSlotId: string | null;
  lastBookingTime: string | null; // HH:mm
  lastBookingDateStr: string | null; // "demain 17:00" for post-booking responses
  offTopicCount: number; // Progressive guardrail counter
}

const logger = pino({ level: "silent" });

class WhatsAppManager {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private awayMessageSent: Map<string, number> = new Map();

  // DB ONLY: Load conversation state from database (single source of truth)
  private async loadState(providerId: string, clientPhone: string): Promise<ConversationState> {
    try {
      const dbSession = await storage.getConversationSession(providerId, clientPhone);
      
      // Si pas de session ou session expirée (30 min), créer une nouvelle
      // BUT preserve lastBooking fields even after session expires (for post-booking address queries)
      if (!dbSession || (dbSession.lastUpdate && Date.now() - new Date(dbSession.lastUpdate).getTime() > 30 * 60 * 1000)) {
        const newState: ConversationState = {
          type: null,
          duration: null,
          basePrice: 0,
          extras: [],
          extrasTotal: 0,
          lastUpdate: Date.now(),
          chatHistory: [],
          serviceId: null,
          slotMapping: {},
          detectedLanguage: "fr",
          lastBookingAt: dbSession?.lastBookingAt ? new Date(dbSession.lastBookingAt).getTime() : null,
          lastBookingAddress: dbSession?.lastBookingAddress || null,
          lastBookingSlotId: dbSession?.lastBookingSlotId || null,
          lastBookingTime: dbSession?.lastBookingTime || null,
          lastBookingDateStr: (dbSession as any)?.lastBookingDateStr || null,
          offTopicCount: 0,
        };
        return newState;
      }
      
      // Convertir la session DB en ConversationState
      return {
        type: dbSession.sessionType as "private" | "escort" | null,
        duration: dbSession.duration,
        basePrice: dbSession.basePrice || 0,
        extras: dbSession.extras || [],
        extrasTotal: dbSession.extrasTotal || 0,
        lastUpdate: dbSession.lastUpdate ? new Date(dbSession.lastUpdate).getTime() : Date.now(),
        chatHistory: (dbSession.chatHistory as ChatMessage[]) || [],
        serviceId: dbSession.serviceId,
        slotMapping: (dbSession.slotMapping as Record<number, string>) || {},
        detectedLanguage: dbSession.detectedLanguage || "fr",
        lastBookingAt: dbSession.lastBookingAt ? new Date(dbSession.lastBookingAt).getTime() : null,
        lastBookingAddress: dbSession.lastBookingAddress || null,
        lastBookingSlotId: dbSession.lastBookingSlotId || null,
        lastBookingTime: dbSession.lastBookingTime || null,
        lastBookingDateStr: (dbSession as any)?.lastBookingDateStr || null,
        offTopicCount: (dbSession as any)?.offTopicCount || 0,
      };
    } catch (error) {
      console.error("[WA-STATE] Failed to load state from DB:", error);
      // Return fresh state on DB error
      return {
        type: null,
        duration: null,
        basePrice: 0,
        extras: [],
        extrasTotal: 0,
        lastUpdate: Date.now(),
        chatHistory: [],
        serviceId: null,
        slotMapping: {},
        detectedLanguage: "fr",
        lastBookingAt: null,
        lastBookingAddress: null,
        lastBookingSlotId: null,
        lastBookingTime: null,
        lastBookingDateStr: null,
        offTopicCount: 0,
      };
    }
  }

  // DB ONLY: Persist conversation state to database (awaited, no fire-and-forget)
  private async persistState(providerId: string, clientPhone: string, state: ConversationState, slotId: string): Promise<ConversationState> {
    const updatedState = { ...state, lastUpdate: Date.now() };
    await storage.upsertConversationSession({
      providerId,
      slotId, // V1 STRICT: Always require slotId for session persistence
      clientPhone,
      serviceId: updatedState.serviceId,
      sessionType: updatedState.type,
      duration: updatedState.duration,
      basePrice: updatedState.basePrice,
      extras: updatedState.extras,
      extrasTotal: updatedState.extrasTotal,
      chatHistory: updatedState.chatHistory,
      slotMapping: updatedState.slotMapping,
      detectedLanguage: updatedState.detectedLanguage,
      lastUpdate: new Date(),
      lastBookingAt: updatedState.lastBookingAt ? new Date(updatedState.lastBookingAt) : null,
      lastBookingAddress: updatedState.lastBookingAddress,
      lastBookingSlotId: updatedState.lastBookingSlotId,
      lastBookingTime: updatedState.lastBookingTime,
      lastBookingDateStr: updatedState.lastBookingDateStr,
      offTopicCount: updatedState.offTopicCount,
    });
    return updatedState;
  }

  // Clear conversation state from DB
  private async clearState(providerId: string, clientPhone: string): Promise<void> {
    await storage.deleteConversationSession(providerId, clientPhone);
  }

  // Helper for awayMessageSent key
  private getConversationKey(providerId: string, clientPhone: string): string {
    return `${providerId}:${clientPhone}`;
  }

  private randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async cleanAuthFiles(providerId: string): Promise<void> {
    const authPath = `./auth_info_baileys/${providerId}`;
    try {
      if (fs.existsSync(authPath)) {
        const files = fs.readdirSync(authPath);
        for (const file of files) {
          fs.unlinkSync(path.join(authPath, file));
        }
        console.log(`[WA-BAILEYS] Cleaned ${files.length} auth files for provider: ${providerId}`);
      }
    } catch (error: any) {
      console.error(`[WA-BAILEYS] Error cleaning auth files:`, error?.message);
    }
  }

  async initSession(providerId: string): Promise<WhatsAppSession> {
    if (this.sessions.has(providerId)) {
      return this.sessions.get(providerId)!;
    }

    const authPath = `./auth_info_baileys/${providerId}`;
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
      console.log("[WA-BAILEYS] Session directory created:", authPath);
    }

    const now = Date.now();
    const session: WhatsAppSession = {
      socket: null,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      providerId,
      slotId: null, // Will be resolved on connection=open
      createdAt: now,
      lastRestart: now,
    };

    this.sessions.set(providerId, session);

    await this.connectSocket(providerId, session);

    return session;
  }

  private async connectSocket(providerId: string, session: WhatsAppSession): Promise<void> {
    const authPath = `./auth_info_baileys/${providerId}`;
    
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const { version } = await fetchLatestBaileysVersion();

      console.log(`[WA-BAILEYS] Starting connection for provider: ${providerId}`);
      console.log(`[WA-BAILEYS] Using Baileys version: ${version.join(".")}`);

      const socket = makeWASocket({
        version,
        logger,
        auth: state,
        printQRInTerminal: false,
        browser: ["Mac OS", "Chrome", "121.0.0.0"],
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => ({ conversation: "" }),
      });

      session.socket = socket;

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log("[WA-BAILEYS] QR Code received!");
          session.qrCode = await qrcode.toDataURL(qr);
          session.connected = false;
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          console.log(`[WA-BAILEYS] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);
          
          session.connected = false;
          session.phoneNumber = null;
          session.qrCode = null;
          await storage.updateProviderProfile(providerId, { whatsappConnected: false });

          if (shouldReconnect) {
            setTimeout(() => this.connectSocket(providerId, session), 5000);
          } else {
            // Logged out (401) - clean auth files for fresh QR code generation
            this.sessions.delete(providerId);
            await this.cleanAuthFiles(providerId);
            console.log(`[WA-BAILEYS] Auth files cleaned for provider: ${providerId}. Ready for new QR.`);
          }
        } else if (connection === "open") {
          session.connected = true;
          session.qrCode = null;
          
          const user = socket.user;
          session.phoneNumber = user?.id?.split(":")[0] || user?.id?.split("@")[0] || null;
          
          // SLOT-AWARE: Resolve slotId by matching WhatsApp phone to slot phone
          let resolvedSlotId: string | null = null;
          if (session.phoneNumber) {
            const normalizedSessionPhone = normalizePhone(session.phoneNumber);
            const providerSlots = await storage.getSlots(providerId);
            for (const slot of providerSlots) {
              const normalizedSlotPhone = normalizePhone(slot.phone);
              if (normalizedSlotPhone && normalizedSlotPhone === normalizedSessionPhone) {
                resolvedSlotId = slot.id;
                break;
              }
            }
          }
          session.slotId = resolvedSlotId;
          
          // Log connection with slot info
          console.log(`[WA-BAILEYS] Connected: providerId=${providerId}, phone=${session.phoneNumber}, slotId=${resolvedSlotId || "none"}`);
          
          await storage.updateProviderProfile(providerId, { whatsappConnected: true });
        }
      });

      socket.ev.on("messages.upsert", async (m) => {
        if (m.type !== "notify") return;

        for (const msg of m.messages) {
          if (!msg.message || msg.key.fromMe) continue;
          await this.handleIncomingMessage(providerId, msg, socket);
        }
      });

    } catch (error: any) {
      console.error(`[WA-BAILEYS] Error initializing for provider ${providerId}:`, error?.message);
    }
  }

  async handleIncomingMessage(
    providerId: string, 
    msg: proto.IWebMessageInfo, 
    socket: WASocket
  ): Promise<void> {
    const remoteJid = msg.key?.remoteJid;
    if (!remoteJid) return;

    // FILTER 1: Ignore all group messages
    if (remoteJid.endsWith("@g.us")) return;

    // FILTER 1b: Ignore media messages (images, audio, video, documents, stickers)
    // Bot only needs text messages to save processing and avoid unnecessary interactions
    const messageContent = msg.message;
    if (messageContent && (
      messageContent.imageMessage ||
      messageContent.audioMessage ||
      messageContent.videoMessage ||
      messageContent.documentMessage ||
      messageContent.stickerMessage ||
      messageContent.contactMessage ||
      messageContent.locationMessage
    )) {
      return;
    }

    const clientPhone = remoteJid.replace("@s.whatsapp.net", "");

    const profile = await storage.getProviderProfileById(providerId);
    if (!profile) return;

    // FILTER 2: Check availability mode - GHOST mode = total silence
    if (profile.availabilityMode === "ghost") {
      return;
    }

    // FILTER 2b: AWAY mode = send unique message then ignore
    if (profile.availabilityMode === "away") {
      const awayKey = this.getConversationKey(providerId, clientPhone);
      const lastAwaySent = this.awayMessageSent.get(awayKey);
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      if (!lastAwaySent || lastAwaySent < oneHourAgo) {
        await this.sendMessage(providerId, clientPhone, "cc! je suis indisponible pour le moment, mais laisse ton message et je te repondrai plus tard");
        this.awayMessageSent.set(awayKey, Date.now());
      }
      return;
    }

    // FILTER 3: Check if sender is a dangerous client (2+ safety reports) - silent ignore
    const isDangerous = await storage.isDangerousClient(clientPhone);
    if (isDangerous) {
      return;
    }

    // Extract text content from various message types
    const content = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ""
    ).toLowerCase().trim();

    // FILTER 4: Ignore empty messages
    if (!content) return;

    const isBlocked = await storage.isBlockedByProvider(providerId, clientPhone);
    if (isBlocked) return;

    const reliability = await storage.getClientReliability(clientPhone);
    if (reliability && reliability.noShowTotal && reliability.noShowTotal >= 2) {
      await this.sendMessage(providerId, clientPhone, "desole, je ne peux plus te donner de rdv. tu as rate trop de rdv sans prevenir.");
      return;
    }

    await storage.isBlacklisted(clientPhone);

    // SLOT-AWARE: Get slotId from session (V1 STRICT: must exist)
    const session = this.sessions.get(providerId);
    const slotId = session?.slotId;
    if (!slotId) {
      console.error(`[WA] No slotId for provider ${providerId} - cannot process message`);
      return; // Silent ignore if no slot configured
    }

    // POST-BOOKING GATE: Check if client has a confirmed upcoming appointment
    const state = await this.loadState(providerId, clientPhone);
    const nowUtc = new Date();
    
    // Look for next confirmed appointment for this client - no horizon limit
    // Uses dedicated method that queries by clientPhone directly, ordered by date, limit 1
    const upcomingAppointment = await storage.getNextClientAppointment(providerId, clientPhone, slotId);
    
    // Post-booking mode if: has upcoming confirmed appointment OR booked within last 2 hours
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const recentlyBooked = state.lastBookingAt && state.lastBookingAt > twoHoursAgo;
    const hasUpcomingAppointment = !!upcomingAppointment;
    
    if (hasUpcomingAppointment || recentlyBooked) {
      // POST-BOOKING MODE: Bot keeps responding, no more silence
      const postBookingResponse = await this.handlePostBookingMessage(
        providerId, 
        clientPhone, 
        content, 
        state,
        profile,
        slotId,
        upcomingAppointment
      );
      await this.sendMessage(providerId, clientPhone, postBookingResponse);
      console.log("[WA] Post-booking response sent");
      return;
    }

    const response = await this.generateAIResponse(providerId, clientPhone, content, profile, slotId);
    await this.sendMessage(providerId, clientPhone, response);
  }

  private isAddressQuery(content: string): boolean {
    // Strict address keyword detection with word boundaries to avoid false positives
    // Multi-word phrases checked first (exact match), then single words with word boundary regex
    const multiWordPhrases = [
      "c'est où", "c'est ou", "cest ou", "cest où",
      "t'es où", "t'es ou", "tes ou", "tes où",
      "comment venir", "google maps"
    ];
    
    // Check multi-word phrases first (these are specific enough)
    if (multiWordPhrases.some(phrase => content.includes(phrase))) {
      return true;
    }
    
    // Single words require word boundary matching to avoid false positives
    // (e.g., "ou" in "journée" or "ouvres" should NOT match)
    const wordBoundaryKeywords = [
      "adresse", "addr", "maps", "localisation"
    ];
    
    for (const kw of wordBoundaryKeywords) {
      // Word boundary: start of string or non-letter before, and end of string or non-letter after
      const regex = new RegExp(`(?:^|[^a-zA-Zàâäéèêëïîôûùüç])${kw}(?:[^a-zA-Zàâäéèêëïîôûùüç]|$)`, 'i');
      if (regex.test(content)) {
        return true;
      }
    }
    
    // Special case: standalone "où" or "ou" as a question (very strict)
    // Only match if the entire message is just "où" or "ou" (with optional punctuation)
    // This avoids matching "journée", "ouvres", "toute", etc.
    if (/^o[uù][?!]*$/.test(content.trim())) {
      return true;
    }
    
    return false;
  }

  // POST-BOOKING MODE: Respond to messages after a booking is confirmed
  private async handlePostBookingMessage(
    providerId: string,
    clientPhone: string,
    content: string,
    state: ConversationState,
    profile: any,
    slotId: string,
    upcomingAppointment?: any
  ): Promise<string> {
    const lowerContent = content.toLowerCase().trim();
    const bookingTime = state.lastBookingTime || "ton rdv";
    const bookingDateStr = state.lastBookingDateStr || "";
    
    // Get display time from appointment if available, otherwise from state
    let displayTime = bookingDateStr || bookingTime;
    if (upcomingAppointment) {
      const aptTime = formatInTimeZone(new Date(upcomingAppointment.appointmentDate), BRUSSELS_TZ, "HH:mm");
      const aptDate = new Date(upcomingAppointment.appointmentDate);
      const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
      const isToday = format(aptDate, "yyyy-MM-dd") === format(nowBrussels, "yyyy-MM-dd");
      displayTime = isToday ? `aujourd'hui a ${aptTime}` : `a ${aptTime}`;
    }
    
    // Check if it's a time/schedule query about their booking
    const isTimeQuery = /ce soir|aujourd|maintenant|quelle heure|a quelle h|cest quand|quand/.test(lowerContent);
    if (isTimeQuery) {
      return `ton rdv est ${displayTime}. sois a l'heure.`;
    }
    
    // Check if asking for address
    if (this.isAddressQuery(content)) {
      // Calculate time until appointment for T-15 rule
      const nowUtc = new Date();
      
      if (upcomingAppointment) {
        const aptTime = new Date(upcomingAppointment.appointmentDate);
        const minutesUntil = (aptTime.getTime() - nowUtc.getTime()) / (1000 * 60);
        
        if (minutesUntil <= 15) {
          // T-15: Give full address
          if (state.lastBookingAddress && state.lastBookingAddress.trim()) {
            return `c'est ici: ${state.lastBookingAddress}. google maps. arrive maintenant.`;
          } else {
            return `adresse pas configuree. jte l'envoi des que possible.`;
          }
        } else {
          // Before T-15: Only street info or timing explanation
          if (state.lastBookingAddress && state.lastBookingAddress.trim()) {
            // Extract just street name if possible
            const streetMatch = state.lastBookingAddress.match(/^[^,\d]+/);
            const streetOnly = streetMatch ? streetMatch[0].trim() : "le quartier";
            const minutesText = Math.floor(minutesUntil);
            return `je suis vers ${streetOnly}. le num exact je tenvoi 15min avant. rdv dans ${minutesText}min.`;
          } else {
            return `je tenvoi l'adresse 15min avant le rdv. sois pret a l'heure.`;
          }
        }
      } else {
        // No appointment found - STRICT: Never give full address without appointment context
        // This enforces T-15 rule: address only revealed 15 min before
        if (state.lastBookingAddress && state.lastBookingAddress.trim()) {
          // Extract just street name
          const streetMatch = state.lastBookingAddress.match(/^[^,\d]+/);
          const streetOnly = streetMatch ? streetMatch[0].trim() : "le quartier";
          return `je suis vers ${streetOnly}. l'adresse exacte je tenvoi 15min avant le rdv.`;
        } else {
          return `je tenvoi l'adresse 15min avant le rdv.`;
        }
      }
    }
    
    // Check if trying to book again (FORBIDDEN in post-booking mode)
    const isNewBookingAttempt = /rdv|reserver|reservation|dispo|creneau|autre heure/.test(lowerContent);
    if (isNewBookingAttempt) {
      return `tu as deja un rdv ${displayTime}. viens a l'heure. si tu veux annuler dis le clairement.`;
    }
    
    // Reassurance messages (allo, ok, merci, etc.)
    const isReassurance = /^(ok|oui|d'?accord|dac|merci|mrc|a toute|a \+|allo|hello|hey|cc|coucou|slt|yo|wsh)/.test(lowerContent);
    if (isReassurance) {
      const reassurances = [
        `j'ai bien recu. ton rdv est ${displayTime}. a toute.`,
        `c'est note. rdv ${displayTime}. sois a l'heure.`,
        `ok parfait. on se voit ${displayTime}.`,
      ];
      return reassurances[Math.floor(Math.random() * reassurances.length)];
    }
    
    // Cancel request detection
    const isCancelRequest = /annuler|cancel|annulation|plus venir|peux pas/.test(lowerContent);
    if (isCancelRequest) {
      return `tu veux annuler ton rdv de ${displayTime}? reponds "oui annuler" pour confirmer.`;
    }
    
    // Explicit cancel confirmation
    if (/oui annuler/.test(lowerContent)) {
      // Cancel the appointment (use passed-in appointment if available)
      if (upcomingAppointment) {
        await storage.updateAppointment(upcomingAppointment.id, { status: "cancelled" });
        // Clear the post-booking state
        await this.persistState(providerId, clientPhone, {
          ...state,
          lastBookingAt: null,
          lastBookingTime: null,
          lastBookingDateStr: null,
          lastBookingAddress: null,
        }, slotId);
        return `rdv annule. a la prochaine.`;
      }
    }
    
    // Default: Acknowledge their booking is confirmed
    return `j'ai bien recu ton message. ton rdv est confirme ${displayTime}. sois a l'heure.`;
  }

  private isGreeting(content: string): boolean {
    const greetings = ["bonjour", "bonsoir", "salut", "hello", "hi", "coucou", "hey", "cc"];
    return greetings.some(g => content.includes(g));
  }

  private isPriceQuery(content: string): boolean {
    const priceKeywords = ["prix", "tarif", "combien", "coût", "cout", "coute"];
    return priceKeywords.some(k => content.includes(k));
  }

  private isPrivateChoice(content: string): boolean {
    const privateKeywords = ["privé", "prive", "private", "priv"];
    return privateKeywords.some(k => content.includes(k));
  }

  private isEscortChoice(content: string): boolean {
    const escortKeywords = ["escort", "escorte", "esc"];
    return escortKeywords.some(k => content.includes(k));
  }

  private isExtrasQuery(content: string): boolean {
    const extrasKeywords = ["extra", "supplement", "option", "bonus"];
    return extrasKeywords.some(k => content.includes(k));
  }

  private isServiceQuery(content: string): boolean {
    const serviceKeywords = ["service", "prestation", "proposez", "faites", "offrez"];
    return serviceKeywords.some(k => content.includes(k));
  }

  private isBookingRequest(content: string): boolean {
    const bookingKeywords = ["rdv", "rendez-vous", "réserver", "reserver", "disponibilité", "disponibilite", "créneau", "creneau", "dispo"];
    return bookingKeywords.some(k => content.includes(k));
  }

  private isSlotSelection(content: string): boolean {
    const timePattern = /\d{1,2}h?\d{0,2}/;
    return timePattern.test(content);
  }

  private isDurationChoice(content: string): boolean {
    const durationKeywords = ["15", "30", "45", "60", "90", "120", "1h", "2h"];
    return durationKeywords.some(k => content.includes(k));
  }

  private censorText(text: string): string {
    const replacements: Record<string, string> = {
      "Anal": "An4l",
      "anal": "an4l",
      "Sans capote": "S@ns capote",
      "sans capote": "s@ns capote",
      "Sex without condom": "S@ns capote",
      "Fellatio without condom": "Fell4tion s@ns",
      "Fellatio": "Fell4tion",
      "fellatio": "fell4tion",
      "Ejaculate on face": "Finition vizage",
      "Swallow sperm": "Av4ler sp3rme",
      "sperm": "sp3rme",
      "Sperm": "Sp3rme",
    };
    let result = text;
    for (const [original, replacement] of Object.entries(replacements)) {
      result = result.replace(new RegExp(original, "g"), replacement);
    }
    return result;
  }

  private getFormattedPriceList(basePrices: any[], serviceExtras: any[], customExtras: any[]): string {
    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 60: "1h", 90: "1h30", 120: "2h"
    };
    
    let result = "";
    
    // TARIFS DE BASE - Privé
    result += "CHEZ MOI (prive):\n";
    basePrices.forEach((p, i) => {
      const label = durationLabels[p.duration] || `${p.duration}min`;
      const price = p.pricePrivate ? p.pricePrivate / 100 : 0;
      if (price > 0) {
        result += `- ${label}: ${price}e\n`;
      }
    });
    
    // TARIFS DE BASE - Escort
    const escortPrices = basePrices.filter(p => p.duration >= 60 && p.priceEscort && p.priceEscort > 0);
    if (escortPrices.length > 0) {
      result += "\nDEPLACEMENT (escort, min 1h):\n";
      escortPrices.forEach((p) => {
        const label = durationLabels[p.duration] || `${p.duration}min`;
        const price = p.priceEscort / 100;
        result += `- ${label}: ${price}e\n`;
      });
    }
    
    // EXTRAS (service_extras + custom_extras fusionnés)
    const allExtras = [...serviceExtras, ...customExtras.map(e => ({ ...e, extraType: e.name }))];
    if (allExtras.length > 0) {
      result += "\nEXTRAS DISPONIBLES:\n";
      allExtras.forEach((e) => {
        const price = e.price ? e.price / 100 : 0;
        const name = e.extraType || e.name;
        result += `- ${name}: +${price}e\n`;
      });
    }
    
    return result || "Tarifs non configures";
  }

  // Helper: Detect if message is on-topic (related to booking flow)
  private isOnTopicMessage(content: string): boolean {
    const lowerContent = content.toLowerCase();
    
    // On-topic patterns: anything booking-related (with word boundaries where needed)
    const onTopicPatterns = [
      /prix|tarif|combien/,
      /rdv|rendez|reserver|reservation|dispo/,
      /^(oui|ok|non|pas)$/i, // Single word confirmations
      /d.?accord|dac|parfait|ca marche/,
      /^\d{1,2}$/, // Just a number (slot selection)
      /\d{1,2}h\d{0,2}/, // Time patterns like 14h30
      /prive|escort/,
      /1h|2h|30min|15min|45min/,
      /demain|aujourd|ce soir|maintenant/,
      /extra|supplement/,
      /merci|mrc|thanks/,
      /annuler|cancel/,
      /adresse|maps|localisation/, // Removed bare "ou" - too many false positives
      /\bou\s+(tu|es|cest|c.?est)\b/, // "où tu es", "où c'est" etc.
      /^(cc|coucou|salut|bonjour|bonsoir|hello|hey)$/i, // Greetings as whole message
    ];
    
    return onTopicPatterns.some(pattern => pattern.test(lowerContent));
  }
  
  // Helper: Detect if message is explicitly off-topic (probing bot nature, etc.)
  private isExplicitlyOffTopic(content: string): boolean {
    const lowerContent = content.toLowerCase();
    
    // Explicit off-topic patterns: questions about bot nature, personal questions, etc.
    const offTopicPatterns = [
      /tes? (un|une)? ?robot/,
      /qui (t|ta) (cree|fait|programme)/,
      /comment tu t.?appelles?/,
      /quel (est)? ?ton (nom|numero|tel)/,
      /(t|ta) (quel)? ?age/,
      /ou tu habites?/,
      /montre (moi)? ?ta? (face|visage|photo)/,
      /mdp|mot de passe|password/,
      /intelligence artificielle|chatgpt|openai|gpt/,
      /tes? humain/,
      /avec qui je parle/,
      /cest quoi (ton|ce) (travail|job|metier)/,
    ];
    
    return offTopicPatterns.some(pattern => pattern.test(lowerContent));
  }

  private async generateAIResponse(
    providerId: string,
    clientPhone: string,
    userMessage: string,
    profile: any,
    slotId: string | null = null
  ): Promise<string> {
    // DB SINGLE SOURCE OF TRUTH: Load state from database
    let convState = await this.loadState(providerId, clientPhone);
    
    // SLOT-AWARE: Fetch slot data for customInstructions/address with provider fallback
    let slot: any = null;
    if (slotId) {
      slot = await storage.getSlot(slotId);
    }
    const effectiveCustomInstructions = slot?.customInstructions || profile.customInstructions || null;
    const effectiveAddress = slot?.address || profile.address || null;
    
    // SYNCHRONISATION TEMPS RÉEL: Récupération FRAÎCHE des données à chaque message
    // V1 STRICT: All storage reads are slot-scoped
    if (!slotId) {
      console.error("[WA-AI] slotId required for generateAIResponse");
      return "desole, erreur technique. reessaie plus tard.";
    }
    const basePrices = await storage.getBasePrices(providerId, slotId);
    const serviceExtras = await storage.getServiceExtras(providerId, slotId);
    const customExtras = await storage.getCustomExtras(providerId, slotId);
    const businessHours = await storage.getBusinessHours(providerId, slotId);
    const services = await storage.getServices(providerId);
    
    // Get available slots for deterministic checks
    const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
    const today = nowBrussels;
    const tomorrow = addDays(today, 1);
    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours, slotId);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours, slotId);
    
    const lowerUserMessage = userMessage.toLowerCase();
    
    // PRE-LLM GUARDS: Handle deterministic responses before calling OpenAI
    
    // GUARD 1: "ce soir" / "aujourd'hui" when today is full
    const isTodayRequest = /ce soir|aujourdhui|aujourd'hui|maintenant|tout de suite/.test(lowerUserMessage);
    const isTodayFull = todaySlots.length === 0;
    const hasTomorrowSlots = tomorrowSlots.length > 0;
    const isTomorrowFull = tomorrowSlots.length === 0;
    
    if (isTodayRequest && isTodayFull) {
      let response: string;
      if (hasTomorrowSlots) {
        // Today full, tomorrow available
        response = `plus de dispo aujourd'hui. je suis libre demain. tu veux voir les horaires?`;
      } else {
        // Both today and tomorrow full
        response = `desole je suis complete aujourd'hui et demain. contacte moi dans quelques jours.`;
      }
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      await this.persistState(providerId, clientPhone, { ...convState, offTopicCount: 0 }, slotId);
      return this.censorText(response);
    }
    
    // GUARD 1b: General "no slots" when both today and tomorrow full (for dispo requests)
    const isDispoRequest = /dispo|creneau|quand|horaire/.test(lowerUserMessage);
    if (isDispoRequest && isTodayFull && isTomorrowFull) {
      const response = `desole je suis complete pour les prochains jours. recontacte moi plus tard.`;
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      await this.persistState(providerId, clientPhone, { ...convState, offTopicCount: 0 }, slotId);
      return this.censorText(response);
    }
    
    // GUARD 2: Off-topic detection and progressive guardrails
    // Off-topic = explicitly off-topic OR (not on-topic AND message length > 3 chars)
    const isOnTopic = this.isOnTopicMessage(userMessage);
    const isExplicitlyOff = this.isExplicitlyOffTopic(userMessage);
    const isUnknownIntent = !isOnTopic && userMessage.trim().length > 3;
    
    if (isExplicitlyOff || isUnknownIntent) {
      convState.offTopicCount = (convState.offTopicCount || 0) + 1;
      
      let response: string;
      if (convState.offTopicCount <= 2) {
        // Soft redirect
        response = "dis moi juste la duree ou l'heure que tu veux";
      } else {
        // Firm redirect after 3+ off-topic messages
        response = "tu veux reserver un rdv ?";
      }
      
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    } else if (isOnTopic) {
      // Reset off-topic counter on relevant messages
      if (convState.offTopicCount > 0) {
        convState.offTopicCount = 0;
        await this.persistState(providerId, clientPhone, convState, slotId);
      }
    }
    
    console.log(`[DYNAMIQUE] Données fraîches récupérées pour le prestataire ${providerId}. Envoi de la réponse...`);
    
    // Note: todaySlots and tomorrowSlots already fetched above for PRE-LLM guards
    
    const activePrices = basePrices.filter(p => p.active);
    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    
    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 60: "1h", 90: "1h30", 120: "2h"
    };
    
    let priceContext = "TARIFS:\n";
    priceContext += "chez moi (prive):\n";
    activePrices.forEach((p, i) => {
      const label = durationLabels[p.duration] || `${p.duration}min`;
      const price = p.pricePrivate ? p.pricePrivate / 100 : 0;
      priceContext += `${i + 1}. ${label}: ${price}e\n`;
    });
    priceContext += "\ndeplacement (escort, min 1h):\n";
    activePrices.filter(p => p.duration >= 60).forEach((p, i) => {
      const label = durationLabels[p.duration] || `${p.duration}min`;
      const price = p.priceEscort ? p.priceEscort / 100 : 0;
      priceContext += `${i + 1}. ${label}: ${price}e\n`;
    });
    
    let extrasContext = "\nEXTRAS DISPONIBLES:\n";
    let extraIndex = 1;
    activeExtras.forEach(e => {
      const price = e.price ? e.price / 100 : 0;
      extrasContext += `${extraIndex}. ${e.extraType}: +${price}e\n`;
      extraIndex++;
    });
    activeCustom.forEach(e => {
      const price = e.price ? e.price / 100 : 0;
      extrasContext += `${extraIndex}. ${e.name}: +${price}e\n`;
      extraIndex++;
    });
    
    let availContext = "\nDISPONIBILITES:\n";
    if (todaySlots.length > 0) {
      availContext += `Aujourd'hui: ${todaySlots.join(", ")}\n`;
    } else {
      availContext += "Aujourd'hui: complet\n";
    }
    if (tomorrowSlots.length > 0) {
      availContext += `Demain (${format(tomorrow, "EEEE d", { locale: fr })}): ${tomorrowSlots.join(", ")}\n`;
    } else {
      availContext += `Demain: complet\n`;
    }
    
    let stateContext = "";
    if (convState.type || convState.duration) {
      stateContext = "\nSELECTION EN COURS:\n";
      if (convState.type) stateContext += `Type: ${convState.type === "private" ? "chez moi" : "deplacement"}\n`;
      if (convState.duration) stateContext += `Duree: ${durationLabels[convState.duration]}\n`;
      if (convState.basePrice) stateContext += `Prix de base: ${convState.basePrice}e\n`;
      if (convState.extras.length > 0) {
        stateContext += `Extras choisis: ${convState.extras.join(", ")} (+${convState.extrasTotal}e)\n`;
        stateContext += `Total: ${convState.basePrice + convState.extrasTotal}e\n`;
      }
    }
    
    // SLOT-AWARE: Use effective custom instructions (slot > provider > empty)
    const customInstructions = effectiveCustomInstructions || "";
    const providerName = slot?.name || profile.businessName || "la prestataire";
    
    // GRILLE TARIFAIRE UNIFIÉE (base + extras fusionnés)
    const fullPriceList = this.getFormattedPriceList(activePrices, activeExtras, activeCustom);
    
    // Liste des créneaux numérotés + SLOT MAPPING pour persistance
    let numberedSlots = "";
    const slotMapping: Record<number, string> = {};
    
    if (todaySlots.length > 0) {
      numberedSlots += "AUJOURD'HUI:\n";
      todaySlots.forEach((slot, i) => {
        const num = i + 1;
        numberedSlots += `${num}. ${slot}\n`;
        slotMapping[num] = slot; // Stocke "1" -> "09:00"
      });
    }
    if (tomorrowSlots.length > 0) {
      const offset = todaySlots.length;
      numberedSlots += `\nDEMAIN (${format(tomorrow, "EEEE d", { locale: fr })}):\n`;
      tomorrowSlots.forEach((slot, i) => {
        const num = offset + i + 1;
        numberedSlots += `${num}. ${slot}\n`;
        slotMapping[num] = `DEMAIN:${slot}`; // Stocke "18" -> "DEMAIN:09:00"
      });
    }
    
    // Persister le slotMapping en base de données (DB SINGLE SOURCE OF TRUTH)
    try {
      convState = await this.persistState(providerId, clientPhone, { ...convState, slotMapping }, slotId);
    } catch (dbError) {
      console.error("[WA-STATE] Failed to persist slotMapping:", dbError);
      return "desole bug interne. reessaie.";
    }
    
    const externalUrl = profile.externalProfileUrl || "";
    
    // Progressive guardrail context
    const offTopicContext = convState.offTopicCount > 0 ? `\nCOMPTEUR HORS-SUJET: ${convState.offTopicCount}/4` : "";
    
    // Better availability context for "ce soir" handling
    const todayFull = todaySlots.length === 0;
    const tomorrowAvailable = tomorrowSlots.length > 0;
    const ceSoirContext = todayFull && tomorrowAvailable 
      ? `\nSI CLIENT DIT "ce soir" ou "aujourd'hui": Reponds "plus de dispo aujourd'hui. je suis libre demain. tu veux voir les horaires?"` 
      : "";
    
    const systemPrompt = `Tu es ${providerName}, un bot de reservation sur whatsapp. Tu es ferme mais humain.

MISSION: Vendre un service et prendre un RDV. Reste focuse sur ca.

HORS-SUJET (GUARDRAILS PROGRESSIFS):
Si le client pose des questions hors-sujet (robot? technique? perso?):
- 1ere ou 2eme fois: Ignore et continue le tunnel, ou reponds "dis moi juste la duree ou l'heure que tu veux"
- 3eme ou 4eme fois: "tu veux reserver un rdv ?"
- Ne dis JAMAIS "on est la pour un rdv. tu veux reserver ou pas?"
INTERDICTION de parler de ta nature de bot.${offTopicContext}

${externalUrl ? `REDIRECTION PHOTOS/VIDEOS:
Si le client demande des photos/videos: "regarde ici: ${externalUrl}. tu veux rdv?"
` : ""}

DETECTION LANGUE:
Reponds dans la langue du client. Si "Hola" -> espagnol. Si "Hello" -> anglais.
Toute la suite doit etre dans cette langue, style SMS brut.

REGLE ABSOLUE: JAMAIS inventer un creneau. Si horaire non liste, refuse.

STYLE SMS:
- Ecris comme par sms: "cc", "tkt", "jsp", "pk", "bcp", "pr", "rdv"
- Fautes volontaires: "darrivé", "tenverai", "jarive", "jai", "cest", "ta"
- ZERO emoji, phrases ultra courtes, direct
- Tutoie toujours

${customInstructions ? `MA PERSONNALITE:\n${customInstructions}\n` : ""}

===== TARIFS =====
${fullPriceList}

===== CRENEAUX DISPO =====
${numberedSlots || "plus de dispo aujourd'hui"}
${stateContext}${ceSoirContext}

TUNNEL DE VENTE:

ETAPE 1 - QUALIFICATION (premier message ou prix):
Envoie la grille tarifaire puis "dis moi si t ok"
NE REPETE PAS les tarifs si deja envoyes dans cette conversation.

ETAPE 2 - RESERVATION (client dit ok/oui):
Affiche les creneaux avec numeros puis:
"sois pas en retard. si tu confirmes vient vraiment sinon le systeme bloque ton numero"

ETAPE 3 - CONFIRMATION (client choisit creneau):
- NUMERO (ex: "3"): trouve lheure correspondante
- HEURE (ex: "14h30"): utilise directement
Tu DOIS inclure ce format EXACT:
[BOOKING:HH:MM] pour aujourdhui ou [BOOKING:DEMAIN:HH:MM] pour demain
Ex: "ok c confirmer 14h30 [BOOKING:14:30]"

GESTION "PAS DE DISPO":
- Si client demande "ce soir" mais complet: "plus de dispo ce soir. demain oui. tu veux?"
- Si client demande horaire non dispo: "desole ${todayFull ? "plus de dispo aujourd'hui" : "ce creneau est pris"}. voici ce qui reste: [liste courte]"
- JAMAIS dire seulement "Aucun creneau disponible" sans alternative

CENSURE:
- "Anal" → "An4l", "Sans capote" → "S@ns capote", "Fellatio" → "Fell4tion"

REGLES:
- Escort minimum 1h
- Jamais dadresse avant confirmation
- REFUSE tout creneau non liste

Reponds au dernier message.`;

    convState.chatHistory.push({ role: "user", content: userMessage });
    
    if (convState.chatHistory.length > 10) {
      convState.chatHistory = convState.chatHistory.slice(-10);
    }
    
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...convState.chatHistory,
    ];
    
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages as any,
        max_tokens: 250,
        temperature: 0.6,
      });
      
      let aiResponse = completion.choices[0]?.message?.content || "desole je ne comprends pas, peux-tu reformuler?";
      
      const bookingMatch = aiResponse.match(/\[BOOKING:(DEMAIN:)?(\d{1,2}):(\d{2})\]/);
      if (bookingMatch) {
        const isTomorrow = !!bookingMatch[1];
        const hour = parseInt(bookingMatch[2]);
        const minute = parseInt(bookingMatch[3]);
        
        // BRUSSELS TIMEZONE ONLY: Create appointment date using fromZonedTime
        const nowUtcBooking = new Date();
        const nowBrusselsBooking = toZonedTime(nowUtcBooking, BRUSSELS_TZ);
        const targetBrusselsDate = isTomorrow ? addDays(nowBrusselsBooking, 1) : nowBrusselsBooking;
        const brusselsDateStrBooking = formatInTimeZone(targetBrusselsDate, BRUSSELS_TZ, "yyyy-MM-dd");
        // Create appointment as UTC Date from Brussels local time
        const appointmentDate = fromZonedTime(`${brusselsDateStrBooking} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, BRUSSELS_TZ);
        
        aiResponse = aiResponse.replace(/\[BOOKING:(DEMAIN:)?(\d{1,2}):(\d{2})\]/, "").trim();
        
        if (appointmentDate <= nowUtcBooking) {
          aiResponse = "desole ce creneau est deja passe, choisis une autre heure stp";
        } else {
          // FORCE: Récupération du service par défaut si aucun serviceId en session
          const activeServices = services.filter(s => s.active);
          let selectedServiceId = convState.serviceId;
          
          // Si pas de serviceId en session, chercher le service 1h (60 min) en priorité
          if (!selectedServiceId && activeServices.length > 0) {
            // Priorité 1: Service avec duration 60 (1h)
            const service1h = activeServices.find(s => s.duration === 60);
            // Priorité 2: Premier service actif
            const fallbackService = service1h || activeServices[0];
            selectedServiceId = fallbackService.id;
            try {
              convState = await this.persistState(providerId, clientPhone, { ...convState, serviceId: selectedServiceId }, slotId);
            } catch (dbError) {
              console.error("[WA-STATE] Failed to persist serviceId:", dbError);
              return "desole bug interne. reessaie.";
            }
            console.log(`[WA-AI] Service forcé (${service1h ? '1h trouvé' : 'fallback'}): ${selectedServiceId}`);
          }
          
          const selectedService = activeServices.find(s => s.id === selectedServiceId) || activeServices[0];
          
          // Validation des créneaux même sans service (serviceId NULLABLE)
          // BRUSSELS TIMEZONE ONLY for all date operations
          const nowForSlots = toZonedTime(new Date(), BRUSSELS_TZ);
          const targetDate = isTomorrow ? addDays(nowForSlots, 1) : nowForSlots;
          const availableSlots = await this.getAvailableSlots(providerId, targetDate, businessHours, slotId);
          // Format in Brussels timezone to match getAvailableSlots output
          const requestedTime = formatInTimeZone(appointmentDate, BRUSSELS_TZ, "HH:mm");
          
          if (!availableSlots.includes(requestedTime)) {
            if (availableSlots.length === 0) {
              const altDate = isTomorrow ? addDays(nowForSlots, 2) : addDays(nowForSlots, 1);
              const altSlots = await this.getAvailableSlots(providerId, altDate, businessHours, slotId);
              const altLabel = isTomorrow ? "apres-demain" : "demain";
              if (altSlots.length > 0) {
                aiResponse = `desole plus de creneau ${isTomorrow ? "demain" : "aujourd'hui"}. dispo ${altLabel}: ${altSlots.slice(0, 4).join(", ")}`;
              } else {
                aiResponse = "desole je suis complete pour les prochains jours, contacte moi plus tard";
              }
            } else {
              aiResponse = `desole ${requestedTime} n'est plus dispo. voici les creneaux libres: ${availableSlots.slice(0, 4).join(", ")}`;
            }
          } else {
            try {
              // ZERO ERREUR: serviceId NULLABLE - la réservation ne doit JAMAIS échouer
              const noteText = [
                !selectedService ? "Service par defaut" : "",
                convState.type ? `Type: ${convState.type}` : "",
                convState.extras.length > 0 ? `Extras: ${convState.extras.join(", ")}` : "",
              ].filter(Boolean).join(". ");
              
              await storage.createAppointment({
                providerId,
                slotId, // V1 STRICT: slotId required (non-null guaranteed by guard at line 788)
                serviceId: selectedService?.id || null, // NULLABLE: plus jamais d'erreur technique
                clientPhone,
                clientName: "",
                appointmentDate,
                duration: convState.duration || selectedService?.duration || 60,
                status: "confirmed",
                notes: noteText || "RDV automatique",
              });
                
                console.log(`[WA-AI] Created appointment for ${clientPhone} at ${formatInTimeZone(appointmentDate, BRUSSELS_TZ, "HH:mm dd/MM")}, slotId=${slotId || "none"}`);
                
                // MESSAGE DE CONFIRMATION FINALE AVEC ADRESSE GPS (slot address with provider fallback)
                const bookedTime = formatInTimeZone(appointmentDate, BRUSSELS_TZ, "HH:mm");
                const resolvedAddress = effectiveAddress || null; // NO "mon adresse" fallback
                
                // Create human-readable booking date string for post-booking responses
                const bookingDateStr = isTomorrow 
                  ? `demain a ${bookedTime}` 
                  : `aujourd'hui a ${bookedTime}`;
                
                // Forcer le message de confirmation (remplace la réponse IA)
                if (resolvedAddress) {
                  aiResponse = `ok c confirmer pour ${bookedTime}. je suis ${resolvedAddress}. regarde sur google maps. je tenvoi le num exact 15min avant. sois la.`;
                } else {
                  aiResponse = `ok c confirmer pour ${bookedTime}. adresse pas configuree dans mon dashboard. jte l'envoi des que possible. sois a l'heure.`;
                }
                
                // Reset conversation state after booking BUT preserve lastBooking info (DB SINGLE SOURCE OF TRUTH)
                try {
                  convState = await this.persistState(providerId, clientPhone, {
                    ...convState,
                    type: null,
                    duration: null,
                    basePrice: 0,
                    extras: [],
                    extrasTotal: 0,
                    slotMapping: {},
                    offTopicCount: 0, // Reset off-topic counter after successful booking
                    lastBookingAt: Date.now(),
                    lastBookingAddress: resolvedAddress,
                    lastBookingSlotId: slotId,
                    lastBookingTime: bookedTime,
                    lastBookingDateStr: bookingDateStr,
                  }, slotId);
                } catch (dbError) {
                  console.error("[WA-STATE] Failed to persist reset state:", dbError);
                }
            } catch (bookingError) {
              console.error("[WA-AI] Error creating appointment:", bookingError);
              aiResponse = "desole y'a eu un bug, reessaie stp";
            }
          }
        }
      }
      
      // Persist chat history (DB SINGLE SOURCE OF TRUTH)
      convState.chatHistory.push({ role: "assistant", content: aiResponse });
      try {
        await this.persistState(providerId, clientPhone, { ...convState, chatHistory: convState.chatHistory }, slotId);
      } catch (dbError) {
        console.error("[WA-STATE] Failed to persist chatHistory:", dbError);
        // Don't return error for chatHistory failure - message still goes through
      }
      
      return this.censorText(aiResponse);
    } catch (error) {
      console.error("[WA-AI] Error generating AI response:", error);
      return "desole y'a eu un souci, reessaie stp";
    }
  }

  private generateGreeting(businessName: string): string {
    return `cc! je suis dispo pour toi\n\ntape *prix* pour mes tarifs\ntape *rdv* pour prendre rdv`;
  }

  private async generatePriceList(providerId: string, slotId: string): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId, slotId);
    const serviceExtras = await storage.getServiceExtras(providerId, slotId);
    const customExtras = await storage.getCustomExtras(providerId, slotId);
    
    const activePrices = basePrices.filter(p => p.active);
    
    if (activePrices.length === 0) {
      return "desole, mes tarifs ne sont pas encore configures";
    }

    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    let response = "mes tarifs:\n\n";
    response += "chez moi | deplacement\n";
    response += "─────────────────\n";
    
    activePrices.forEach(price => {
      const label = durationLabels[price.duration] || `${price.duration}min`;
      const priv = price.pricePrivate ? (price.pricePrivate / 100) : 0;
      if (price.duration >= 60) {
        const esc = price.priceEscort ? (price.priceEscort / 100) : 0;
        response += `${label}: ${priv}e | ${esc}e\n`;
      } else {
        response += `${label}: ${priv}e\n`;
      }
    });

    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    
    if (activeExtras.length > 0 || activeCustom.length > 0) {
      response += "\nmes extras:\n";
      activeExtras.forEach(extra => {
        const extraPrice = extra.price ? (extra.price / 100) : 0;
        response += `- ${this.censorText(extra.extraType)}: +${extraPrice}e\n`;
      });
      activeCustom.forEach(extra => {
        const extraPrice = extra.price ? (extra.price / 100) : 0;
        response += `- ${this.censorText(extra.name)}: +${extraPrice}e\n`;
      });
    }

    response += "\ntape *prive* pour chez moi\ntape *escort* pour deplacement (1h min)";
    return response;
  }

  private async generateDurationOptions(providerId: string, clientPhone: string, type: "private" | "escort", slotId: string): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId, slotId);
    let activePrices = basePrices.filter(p => p.active);
    
    if (type === "escort") {
      activePrices = activePrices.filter(p => p.duration >= 60);
    }
    
    if (activePrices.length === 0) {
      if (type === "escort") {
        return "desole, je me deplace uniquement pour 1h minimum\n\ntape *prive* pour chez moi";
      }
      return "desole, aucun tarif dispo";
    }

    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    const typeLabel = type === "private" ? "chez moi" : "deplacement";
    let response = `ok ${typeLabel}! choisis la duree:\n\n`;
    
    activePrices.forEach((price, i) => {
      const label = durationLabels[price.duration] || `${price.duration}min`;
      const priceValue = type === "private" 
        ? (price.pricePrivate ? price.pricePrivate / 100 : 0)
        : (price.priceEscort ? price.priceEscort / 100 : 0);
      response += `${i + 1}. ${label} - ${priceValue}e\n`;
    });

    response += "\ntape le numero (1, 2, 3...)";
    response += "\ntape *extras* pour voir mes options";
    return response;
  }

  private async handleDurationChoice(providerId: string, clientPhone: string, content: string, type: "private" | "escort", slotId: string): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId, slotId);
    let activePrices = basePrices.filter(p => p.active);
    
    if (type === "escort") {
      activePrices = activePrices.filter(p => p.duration >= 60);
    }
    
    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    let selectedDuration: number | null = null;
    let selectedPrice = 0;

    const numMatch = content.match(/^(\d)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1]) - 1;
      if (index >= 0 && index < activePrices.length) {
        const price = activePrices[index];
        selectedDuration = price.duration;
        selectedPrice = type === "private" 
          ? (price.pricePrivate || 0) / 100
          : (price.priceEscort || 0) / 100;
      }
    } else {
      for (const price of activePrices) {
        if (content.includes(String(price.duration)) || 
            content.includes(durationLabels[price.duration]?.replace(" ", ""))) {
          selectedDuration = price.duration;
          selectedPrice = type === "private" 
            ? (price.pricePrivate || 0) / 100
            : (price.priceEscort || 0) / 100;
          break;
        }
      }
    }

    if (!selectedDuration) {
      return "j'ai pas compris, tape le numero (1, 2, 3...)";
    }

    // DB SINGLE SOURCE OF TRUTH: Persist duration selection
    const currentState = await this.loadState(providerId, clientPhone);
    try {
      await this.persistState(providerId, clientPhone, { 
        ...currentState,
        duration: selectedDuration, 
        basePrice: selectedPrice 
      }, slotId);
    } catch (dbError) {
      console.error("[WA-STATE] Failed to persist duration:", dbError);
      return "desole bug interne. reessaie.";
    }

    const label = durationLabels[selectedDuration] || `${selectedDuration}min`;
    const typeLabel = type === "private" ? "chez moi" : "deplacement";
    
    let response = `ok! ${typeLabel} ${label}: ${selectedPrice}e\n\n`;
    response += "tape *extras* pour ajouter des options\n";
    response += "tape *total* pour le recap\n";
    response += "tape *rdv* pour reserver";
    
    return response;
  }

  private async generateTotalRecap(providerId: string, clientPhone: string): Promise<string> {
    // DB SINGLE SOURCE OF TRUTH: Load state from database
    const state = await this.loadState(providerId, clientPhone);
    
    if (!state.type || !state.duration) {
      return "pas de selection en cours\n\ntape *prive* ou *escort* pour commencer";
    }

    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    const typeLabel = state.type === "private" ? "chez moi" : "deplacement";
    const durationLabel = durationLabels[state.duration] || `${state.duration}min`;
    const total = state.basePrice + state.extrasTotal;

    let response = `recap:\n\n`;
    response += `${typeLabel} - ${durationLabel}\n`;
    response += `base: ${state.basePrice}e\n`;
    
    if (state.extras.length > 0) {
      response += `extras: ${state.extras.map((e: string) => this.censorText(e)).join(", ")}\n`;
      response += `+ ${state.extrasTotal}e\n`;
    }
    
    response += `\ntotal: ${total}e\n\n`;
    response += "tape *rdv* pour reserver";
    
    return response;
  }

  private async generateExtrasList(providerId: string, clientPhone: string, slotId: string): Promise<string> {
    const serviceExtras = await storage.getServiceExtras(providerId, slotId);
    const customExtras = await storage.getCustomExtras(providerId, slotId);
    // DB SINGLE SOURCE OF TRUTH: Load state from database
    const state = await this.loadState(providerId, clientPhone);
    
    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    
    if (activeExtras.length === 0 && activeCustom.length === 0) {
      return "pas d'extras dispo pour le moment";
    }

    let response = "mes extras:\n\n";
    
    let index = 1;
    activeExtras.forEach(extra => {
      const price = extra.price ? (extra.price / 100) : 0;
      const selected = state.extras.includes(extra.extraType) ? " [ok]" : "";
      response += `${index}. ${this.censorText(extra.extraType)}: +${price}e${selected}\n`;
      index++;
    });
    
    activeCustom.forEach(extra => {
      const price = extra.price ? (extra.price / 100) : 0;
      const selected = state.extras.includes(extra.name) ? " [ok]" : "";
      response += `${index}. ${this.censorText(extra.name)}: +${price}e${selected}\n`;
      index++;
    });

    response += "\ntape +1, +2, +3... pour ajouter";
    response += "\ntape *total* pour le recap";
    return response;
  }

  private async handleExtraSelection(providerId: string, clientPhone: string, selection: string, slotId: string): Promise<string> {
    const serviceExtras = await storage.getServiceExtras(providerId, slotId);
    const customExtras = await storage.getCustomExtras(providerId, slotId);
    // DB SINGLE SOURCE OF TRUTH: Load state from database
    const state = await this.loadState(providerId, clientPhone);
    
    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    const allExtras = [
      ...activeExtras.map(e => ({ name: e.extraType, price: e.price || 0 })),
      ...activeCustom.map(e => ({ name: e.name, price: e.price || 0 })),
    ];

    const numMatch = selection.match(/^(\d+)$/);
    let selectedExtra: { name: string; price: number } | null = null;

    if (numMatch) {
      const index = parseInt(numMatch[1]) - 1;
      if (index >= 0 && index < allExtras.length) {
        selectedExtra = allExtras[index];
      }
    } else {
      selectedExtra = allExtras.find(e => 
        e.name.toLowerCase().includes(selection.toLowerCase())
      ) || null;
    }

    if (!selectedExtra) {
      return "j'ai pas trouve, tape +1, +2, +3...";
    }

    if (state.extras.includes(selectedExtra.name)) {
      return `${this.censorText(selectedExtra.name)} deja ajoute\n\ntape *total* pour le recap`;
    }

    const newExtras = [...state.extras, selectedExtra.name];
    const newExtrasTotal = state.extrasTotal + (selectedExtra.price / 100);
    
    // DB SINGLE SOURCE OF TRUTH: Persist extras selection
    try {
      await this.persistState(providerId, clientPhone, {
        ...state,
        extras: newExtras,
        extrasTotal: newExtrasTotal,
      }, slotId);
    } catch (dbError) {
      console.error("[WA-STATE] Failed to persist extras:", dbError);
      return "desole bug interne. reessaie.";
    }

    const total = state.basePrice + newExtrasTotal;
    
    let response = `ok! ${this.censorText(selectedExtra.name)} ajoute (+${selectedExtra.price / 100}e)\n\n`;
    response += `extras: ${newExtras.map(e => this.censorText(e)).join(", ")}\n`;
    response += `total: ${total}e\n\n`;
    response += "tape *extras* pour en ajouter\n";
    response += "tape *total* pour le recap\n";
    response += "tape *rdv* pour reserver";
    
    return response;
  }

  private generateServiceInfo(services: any[]): string {
    if (services.length === 0) {
      return "desole, pas de service dispo";
    }

    let response = "mes services:\n\n";
    services
      .filter(s => s.active)
      .forEach(service => {
        response += `- ${service.name}`;
        if (service.description) {
          response += ` (${service.description})`;
        }
        response += `\n`;
      });

    response += "\ntape *prix* pour mes tarifs";
    return response;
  }

  private async generateAvailableSlots(providerId: string, clientPhone: string, services: any[], businessHours: any[]): Promise<string> {
    // BRUSSELS TIMEZONE ONLY for all date operations
    const today = toZonedTime(new Date(), BRUSSELS_TZ);
    const tomorrow = addDays(today, 1);

    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours);

    let response = "mes dispos:\n\n";

    if (todaySlots.length > 0) {
      response += "aujourd'hui:\n";
      todaySlots.forEach((slot, i) => {
        response += `${i + 1}. ${slot}\n`;
      });
    } else {
      response += "aujourd'hui: complet\n";
    }

    response += "\n";

    if (tomorrowSlots.length > 0) {
      response += `${format(tomorrow, "EEEE d", { locale: fr })}:\n`;
      tomorrowSlots.forEach((slot, i) => {
        response += `${todaySlots.length + i + 1}. ${slot}\n`;
      });
    } else {
      response += `${format(tomorrow, "EEEE d", { locale: fr })}: complet\n`;
    }

    response += "\ntape le numero pour reserver (ex: 1)";

    return response;
  }

  private async getAvailableSlots(providerId: string, date: Date, businessHours: any[], slotId: string | null = null): Promise<string[]> {
    // BRUSSELS TIMEZONE ONLY: All dates are in Brussels timezone
    const brusselsDate = toZonedTime(date, BRUSSELS_TZ);
    const dayOfWeek = brusselsDate.getDay();
    const dayHours = businessHours.find(h => h.dayOfWeek === dayOfWeek);

    if (!dayHours || dayHours.isClosed) {
      return [];
    }

    const slots: string[] = [];
    const [openH, openM] = (dayHours.openTime as string).split(":").map(Number);
    const [closeH, closeM] = (dayHours.closeTime as string).split(":").map(Number);

    // Create Brussels day bounds using fromZonedTime (converts Brussels local time to UTC Date)
    const brusselsDateStr = formatInTimeZone(date, BRUSSELS_TZ, "yyyy-MM-dd");
    const startOfDayDate = fromZonedTime(`${brusselsDateStr} 00:00:00`, BRUSSELS_TZ);
    const endOfDayDate = fromZonedTime(`${brusselsDateStr} 23:59:59`, BRUSSELS_TZ);

    // V1 STRICT: slotId required for slot-scoped data access
    if (!slotId) {
      console.error("[WA] slotId required for getAvailableSlots");
      return [];
    }
    const existingAppointments = await storage.getAppointments(providerId, startOfDayDate, endOfDayDate, slotId);
    const blockedSlots = await storage.getBlockedSlots(providerId, startOfDayDate, endOfDayDate, slotId);

    // Current time as UTC Date (for comparison)
    const nowUtc = new Date();

    let currentHour = openH;
    let currentMinute = openM;

    // Generate slots in 30-min steps until closeTime (NO hard limit)
    while (currentHour < closeH || (currentHour === closeH && currentMinute < closeM)) {
      // Create slot time using fromZonedTime (Brussels local time → UTC Date)
      const slotTimeStr = `${brusselsDateStr} ${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}:00`;
      const slotTime = fromZonedTime(slotTimeStr, BRUSSELS_TZ);

      // Slot must be strictly in the future (compare UTC dates)
      if (slotTime > nowUtc) {
        const isBooked = existingAppointments.some(apt => {
          if (apt.status === "cancelled" || apt.status === "no-show") {
            return false;
          }
          // Appointments are stored as UTC, compare directly
          const aptTime = typeof apt.appointmentDate === "string" 
            ? parseISO(apt.appointmentDate) 
            : apt.appointmentDate;
          const aptDuration = apt.duration || 60;
          const aptEndTime = new Date(aptTime.getTime() + aptDuration * 60 * 1000);
          
          // Slot overlaps if it falls within appointment window
          return slotTime >= aptTime && slotTime < aptEndTime;
        });

        const isBlocked = blockedSlots.some(slot => {
          const start = typeof slot.startTime === "string" ? parseISO(slot.startTime) : slot.startTime;
          const end = typeof slot.endTime === "string" ? parseISO(slot.endTime) : slot.endTime;
          return slotTime >= start && slotTime < end;
        });

        if (!isBooked && !isBlocked) {
          // Format in Brussels timezone for display
          slots.push(formatInTimeZone(slotTime, BRUSSELS_TZ, "HH:mm"));
        }
      }

      // 30-minute steps
      currentMinute += 30;
      if (currentMinute >= 60) {
        currentMinute = 0;
        currentHour += 1;
      }
    }

    // Return ALL available slots (NO hard limit)
    return slots;
  }

  private async handleSlotSelection(providerId: string, clientPhone: string, content: string, services: any[], slotId: string): Promise<string> {
    const timeMatch = content.match(/(\d{1,2})h?(\d{0,2})/);
    
    if (!timeMatch) {
      return "J'ai pas compris. Indique l'heure souhaitee (ex: 14h ou 14h30).";
    }

    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2] || "0");

    // BRUSSELS TIMEZONE ONLY for all date operations
    const isToday = !content.includes("demain");
    const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
    const brusselsDateStr = formatInTimeZone(isToday ? nowBrussels : addDays(nowBrussels, 1), BRUSSELS_TZ, "yyyy-MM-dd");
    // Use fromZonedTime to convert Brussels local time to UTC Date
    const appointmentDate = fromZonedTime(`${brusselsDateStr} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, BRUSSELS_TZ);

    const activeServices = services.filter(s => s.active);
    if (activeServices.length === 0) {
      return "Desole, aucun service dispo.";
    }

    const selectedService = activeServices[0];

    try {
      await storage.createAppointment({
        providerId,
        slotId, // V1 STRICT: slotId required
        serviceId: selectedService.id,
        clientPhone,
        clientName: null,
        appointmentDate,
        duration: selectedService.duration,
        status: "confirmed",
        reminderSent: false,
        notes: null,
      });

      // Format in Brussels timezone
      const formattedDate = formatInTimeZone(appointmentDate, BRUSSELS_TZ, "EEEE d MMMM 'a' HH:mm", { locale: fr });
      
      return `ok c'est note! rdv ${formattedDate}\n\nje t'envoie un rappel 1h avant\na bientot`;
    } catch (error) {
      console.error("Error creating appointment:", error);
      return "oups erreur, reessaie stp";
    }
  }

  private generateDefaultResponse(businessName: string): string {
    return `cc!\n\ntape *prix* pour mes tarifs\ntape *rdv* pour reserver`;
  }

  async sendNoShowWarning(providerId: string, clientPhone: string): Promise<void> {
    const message = "coucou, je vois que tu n'es pas venu... s'il te plait, ne reserve que si tu es certain de venir. mon systeme bloque les numeros apres deux absences, donc si tu rates le prochain, je ne pourrai plus te donner de rdv. on fait attention?";
    await this.sendMessage(providerId, clientPhone, message);
  }

  async sendMessage(providerId: string, to: string, message: string) {
    const session = this.sessions.get(providerId);
    if (!session?.connected || !session.socket) {
      return;
    }

    try {
      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
      
      const thinkDelay = this.randomDelay(1000, 3000);
      await delay(thinkDelay);

      await session.socket.presenceSubscribe(jid);
      await delay(500);
      
      await session.socket.sendPresenceUpdate("composing", jid);
      const typingDelay = this.randomDelay(2000, 5000);
      await delay(typingDelay);
      
      await session.socket.sendPresenceUpdate("paused", jid);

      const censoredMessage = this.censorText(message);
      await session.socket.sendMessage(jid, { text: censoredMessage });
    } catch (error) {
      console.error("[WA-BAILEYS] Error sending message:", error);
    }
  }

  getStatus(providerId: string): { connected: boolean; qrCode: string | null; phoneNumber: string | null } {
    const session = this.sessions.get(providerId);
    return {
      connected: session?.connected || false,
      qrCode: session?.qrCode || null,
      phoneNumber: session?.phoneNumber || null,
    };
  }

  async disconnect(providerId: string): Promise<void> {
    const session = this.sessions.get(providerId);
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch (error) {
        // Silent fail on disconnect
      }
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore socket close errors
      }
    }
    this.sessions.delete(providerId);
    // Clean auth files immediately after logout to allow fresh QR generation
    await this.cleanAuthFiles(providerId);
    await storage.updateProviderProfile(providerId, { whatsappConnected: false });
    console.log(`[WA-BAILEYS] Disconnected and cleaned for provider: ${providerId}`);
  }

  async refreshQR(providerId: string): Promise<void> {
    const session = this.sessions.get(providerId);
    
    // Don't refresh if already connected - require explicit disconnect first
    if (session?.connected) {
      console.log(`[WA-BAILEYS] Session already connected for provider: ${providerId}, skipping refresh`);
      return;
    }
    
    // Close existing socket if any
    if (session?.socket) {
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore socket close errors
      }
    }
    
    // Remove session from map
    this.sessions.delete(providerId);
    
    // Clean auth files to force new QR code generation
    await this.cleanAuthFiles(providerId);
    
    // Start fresh session
    console.log(`[WA-BAILEYS] Refreshing QR for provider: ${providerId}`);
    await this.initSession(providerId);
  }

  async forceReconnect(providerId: string): Promise<void> {
    console.log(`[WA-BAILEYS] Force reconnect requested for provider: ${providerId}`);
    
    const session = this.sessions.get(providerId);
    
    // Close and cleanup existing socket
    if (session?.socket) {
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore socket close errors
      }
    }
    
    // Remove session and clean auth files
    this.sessions.delete(providerId);
    await this.cleanAuthFiles(providerId);
    await storage.updateProviderProfile(providerId, { whatsappConnected: false });
    
    // Start fresh session for new QR code
    await this.initSession(providerId);
    console.log(`[WA-BAILEYS] Force reconnect completed for provider: ${providerId}`);
  }

  cleanupExpiredConversations(): void {
    // DB handles conversation state expiration via lastUpdate check in loadState()
    // No in-memory state to clean up anymore (DB is single source of truth)
    
    // Clean up awayMessageSent cache only
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const awayEntries = Array.from(this.awayMessageSent.entries());
    for (const [key, timestamp] of awayEntries) {
      if (now - timestamp > oneHour) {
        this.awayMessageSent.delete(key);
      }
    }
  }

  initMaintenanceJobs(): void {
    cron.schedule("0 4 * * *", async () => {
      console.log("[WA-BAILEYS] Running daily maintenance (4 AM)...");
      this.cleanupExpiredConversations();
    });

    cron.schedule("*/15 * * * *", () => {
      this.cleanupExpiredConversations();
    });

    console.log("[WhatsApp] Maintenance jobs initialized");
  }
}

export const whatsappManager = new WhatsAppManager();

whatsappManager.initMaintenanceJobs();
