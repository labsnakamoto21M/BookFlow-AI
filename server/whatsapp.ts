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

type IntentType = 
  | "greeting"
  | "availability" 
  | "price_query"
  | "extras_query"
  | "duration_choice"
  | "slot_selection"
  | "booking_confirm"
  | "service_type_private"
  | "service_type_escort"
  | "cancel_request"
  | "cancel_confirm"
  | "address_query"
  | "reassurance"
  | "arrival"
  | "time_query"
  | "photo_request"
  | "off_topic";

interface ClassifiedIntent {
  intent: IntentType;
  confidence: number;
  entities: {
    duration?: number;
    time?: string;
    slotNumber?: number;
    language?: string;
  };
}

const logger = pino({ level: "silent" });

class WhatsAppManager {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private awayMessageSent: Map<string, number> = new Map();

  private sessionKey(providerId: string, slotId: string): string {
    return `${providerId}_${slotId}`;
  }

  // DB ONLY: Load conversation state from database (single source of truth)
  private async loadState(providerId: string, slotId: string, clientPhone: string): Promise<ConversationState> {
    try {
      const dbSession = await storage.getConversationSession(providerId, slotId, clientPhone);
      
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
  private async clearState(providerId: string, slotId: string, clientPhone: string): Promise<void> {
    await storage.deleteConversationSession(providerId, slotId, clientPhone);
  }

  private async classifyIntent(
    userMessage: string, 
    detectedLanguage: string,
    conversationContext: string,
    isPostBooking: boolean
  ): Promise<ClassifiedIntent> {
    const postBookingIntents = isPostBooking 
      ? `- "time_query": asking about appointment time/schedule ("c quand?", "a quelle heure?", "when is it?")
- "arrival": client says they arrived or are nearby ("je suis la", "arrived", "jsuis devant", "ik ben er")
- "cancel_request": wants to cancel ("annule", "je peux pas", "can't come", "peux plus", "cancel")
- "cancel_confirm": confirms cancellation ("oui annuler", "yes cancel", "confirme annulation")
- "reassurance": acknowledging/thanking ("ok", "merci", "d'accord", "perfect", "a toute")
- "address_query": asking where/location ("c'est ou?", "adresse?", "where?", "t'es ou?")
- "booking_confirm": trying to book again ("rdv", "reserver", "autre heure", "dispo")
- "off_topic": unrelated to booking` 
      : `- "greeting": hello/hi/salut/cc/coucou/hey/bonjour/bonsoir
- "availability": asking when free/available ("quand libre?", "dispo?", "t occupee?", "when free?", "horaires?", "creneau?")
- "price_query": asking about prices/rates ("combien?", "tarifs?", "prix?", "how much?", "prices?")
- "extras_query": asking about extras/options ("tu fais quoi comme extra?", "quels extras?", "tu proposes des extras?", "what extras?", "options?", "wat extras?")
- "duration_choice": choosing a duration ("1h", "30min", "une heure", "2h", or a number selecting from a list)
- "slot_selection": choosing a time slot (a number like "3" or time like "14h30", "15h")
- "booking_confirm": confirming/agreeing to book ("oui", "ok", "d'accord", "dac", "ca marche", "parfait", "yes")
- "service_type_private": choosing private/incall ("prive", "chez toi", "private", "incall")
- "service_type_escort": choosing escort/outcall ("escort", "deplacement", "outcall", "chez moi")
- "cancel_request": wants to cancel ("annule", "cancel", "je peux pas")
- "address_query": asking where/location ("c'est ou?", "adresse?", "where?", "t'es ou?")
- "photo_request": asking for photos/videos ("photo", "video", "pic", "image")
- "reassurance": simple acknowledgment ("ok", "merci", "thanks")
- "off_topic": unrelated to booking (personal questions, bot nature questions, random chat)`;

    const classifierPrompt = `Classify this WhatsApp message intent for a booking service. Return ONLY valid JSON.

${isPostBooking ? "CONTEXT: Client already has a confirmed booking." : "CONTEXT: Client is in pre-booking conversation."}
${conversationContext ? `RECENT CONVERSATION:\n${conversationContext}` : ""}

INTENTS:
${postBookingIntents}

EXAMPLES:
"cc" → {"intent":"greeting","confidence":0.95,"entities":{}}
"quand libre?" → {"intent":"availability","confidence":0.95,"entities":{}}
"t occupee?" → {"intent":"availability","confidence":0.9,"entities":{}}
"combien?" → {"intent":"price_query","confidence":0.95,"entities":{}}
"tu fais quoi comme extra?" → {"intent":"extras_query","confidence":0.95,"entities":{}}
"quels services?" → {"intent":"extras_query","confidence":0.85,"entities":{}}
"1h" → {"intent":"duration_choice","confidence":0.95,"entities":{"duration":60}}
"30min" → {"intent":"duration_choice","confidence":0.95,"entities":{"duration":30}}
"3" → {"intent":"slot_selection","confidence":0.9,"entities":{"slotNumber":3}}
"14h30" → {"intent":"slot_selection","confidence":0.9,"entities":{"time":"14:30"}}
"oui" → {"intent":"booking_confirm","confidence":0.85,"entities":{}}
"prive" → {"intent":"service_type_private","confidence":0.95,"entities":{}}
"escort" → {"intent":"service_type_escort","confidence":0.95,"entities":{}}
"je peux pas venir" → {"intent":"cancel_request","confidence":0.9,"entities":{}}
"oui annuler" → {"intent":"cancel_confirm","confidence":0.95,"entities":{}}
"c'est ou?" → {"intent":"address_query","confidence":0.95,"entities":{}}
"jsuis la" → {"intent":"arrival","confidence":0.9,"entities":{}}
"c quand mon rdv?" → {"intent":"time_query","confidence":0.95,"entities":{}}
"ok merci" → {"intent":"reassurance","confidence":0.9,"entities":{}}
"tes un robot?" → {"intent":"off_topic","confidence":0.95,"entities":{}}

MESSAGE (${detectedLanguage}): "${userMessage}"

Return ONLY the JSON object:`;

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: classifierPrompt }],
        max_tokens: 100,
        temperature: 0.1,
      });

      const raw = completion.choices[0]?.message?.content?.trim() || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validIntents: IntentType[] = [
          "greeting", "availability", "price_query", "extras_query",
          "duration_choice", "slot_selection", "booking_confirm",
          "service_type_private", "service_type_escort",
          "cancel_request", "cancel_confirm", "address_query",
          "reassurance", "arrival", "time_query", "photo_request", "off_topic"
        ];
        if (validIntents.includes(parsed.intent)) {
          return {
            intent: parsed.intent,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
            entities: parsed.entities || {},
          };
        }
      }
      console.warn("[CLASSIFIER] Invalid GPT response, falling back to regex:", raw);
      return this.classifyIntentFallback(userMessage, isPostBooking);
    } catch (error) {
      console.error("[CLASSIFIER] GPT call failed, falling back to regex:", error);
      return this.classifyIntentFallback(userMessage, isPostBooking);
    }
  }

  private classifyIntentFallback(userMessage: string, isPostBooking: boolean): ClassifiedIntent {
    const lc = userMessage.toLowerCase().trim();

    if (isPostBooking) {
      if (/oui annuler|yes cancel|confirme annul/.test(lc)) 
        return { intent: "cancel_confirm", confidence: 0.9, entities: {} };
      if (/annuler|cancel|annulation|plus venir|peux pas|peux plus|je viens pas/.test(lc))
        return { intent: "cancel_request", confidence: 0.85, entities: {} };
      if (/je suis (la|là)|jsuis (la|là)|arrived|arrivé|arrivee|devant|en bas|ik ben er/.test(lc))
        return { intent: "arrival", confidence: 0.9, entities: {} };
      if (/quelle heure|a quelle h|cest quand|quand|when|ce soir|aujourd/.test(lc))
        return { intent: "time_query", confidence: 0.8, entities: {} };
      if (this.isAddressQuery(lc))
        return { intent: "address_query", confidence: 0.9, entities: {} };
      if (/rdv|reserver|reservation|dispo|creneau|autre heure/.test(lc))
        return { intent: "booking_confirm", confidence: 0.8, entities: {} };
      if (/^(ok|oui|d'?accord|dac|merci|mrc|a toute|a \+|allo|hello|hey|cc|coucou|slt|yo|wsh|parfait|super|top|nickel|cool|bien)/.test(lc))
        return { intent: "reassurance", confidence: 0.8, entities: {} };
      return { intent: "off_topic", confidence: 0.5, entities: {} };
    }

    if (/^(cc|coucou|salut|bonjour|bonsoir|hello|hey|hi|slt|yo|wsh|hola|ola)$/i.test(lc))
      return { intent: "greeting", confidence: 0.95, entities: {} };
    if (/dispo|libre|available|free|creneau|quand|when|horaire|place|schedule/.test(lc))
      return { intent: "availability", confidence: 0.85, entities: {} };
    if (/prix|tarif|combien|coût|cout|coute|price|how much|hoeveel/.test(lc))
      return { intent: "price_query", confidence: 0.9, entities: {} };
    if (/extra|supplement|option|bonus|service|prestation|proposez|faites|offrez/.test(lc))
      return { intent: "extras_query", confidence: 0.85, entities: {} };
    if (/privé|prive|private|priv|chez toi|incall/.test(lc))
      return { intent: "service_type_private", confidence: 0.9, entities: {} };
    if (/escort|escorte|deplacement|outcall|chez moi/.test(lc))
      return { intent: "service_type_escort", confidence: 0.9, entities: {} };
    if (/annuler|cancel|annulation/.test(lc))
      return { intent: "cancel_request", confidence: 0.85, entities: {} };
    if (this.isAddressQuery(lc))
      return { intent: "address_query", confidence: 0.9, entities: {} };
    if (/photo|video|pic|image|foto/.test(lc))
      return { intent: "photo_request", confidence: 0.85, entities: {} };
    
    const durationMatch = lc.match(/(\d+)\s*(?:h|min|hour|heure)/);
    if (durationMatch) {
      const num = parseInt(durationMatch[1]);
      const isMin = /min/.test(durationMatch[0]);
      return { intent: "duration_choice", confidence: 0.85, entities: { duration: isMin ? num : num * 60 } };
    }
    
    if (/^\d{1,2}$/.test(lc)) {
      const num = parseInt(lc);
      return { intent: "slot_selection", confidence: 0.8, entities: { slotNumber: num } };
    }
    
    const timeMatch = lc.match(/(\d{1,2})h(\d{0,2})/);
    if (timeMatch) {
      const h = timeMatch[1].padStart(2, "0");
      const m = (timeMatch[2] || "00").padStart(2, "0");
      return { intent: "slot_selection", confidence: 0.85, entities: { time: `${h}:${m}` } };
    }

    if (/^(oui|ok|d'?accord|dac|ca marche|parfait|yes|ja|si|da)$/i.test(lc))
      return { intent: "booking_confirm", confidence: 0.8, entities: {} };
    if (/^(merci|mrc|thanks|thx|dank)$/i.test(lc))
      return { intent: "reassurance", confidence: 0.85, entities: {} };

    return { intent: "off_topic", confidence: 0.5, entities: {} };
  }

  // Helper for awayMessageSent key
  private getConversationKey(providerId: string, clientPhone: string): string {
    return `${providerId}:${clientPhone}`;
  }

  private randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async cleanAuthFiles(providerId: string, slotId: string): Promise<void> {
    const authPath = `./auth_info_baileys/${providerId}_${slotId}`;
    try {
      if (fs.existsSync(authPath)) {
        const files = fs.readdirSync(authPath);
        for (const file of files) {
          fs.unlinkSync(path.join(authPath, file));
        }
        console.log(`[WA-BAILEYS] Cleaned ${files.length} auth files for provider: ${providerId}, slot: ${slotId}`);
      }
    } catch (error: any) {
      console.error(`[WA-BAILEYS] Error cleaning auth files:`, error?.message);
    }
  }

  async initSession(providerId: string, slotId: string): Promise<WhatsAppSession> {
    const key = this.sessionKey(providerId, slotId);
    if (this.sessions.has(key)) {
      return this.sessions.get(key)!;
    }

    const authPath = `./auth_info_baileys/${providerId}_${slotId}`;
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
      slotId,
      createdAt: now,
      lastRestart: now,
    };

    this.sessions.set(key, session);

    await this.connectSocket(providerId, slotId, session);

    return session;
  }

  private async connectSocket(providerId: string, slotId: string, session: WhatsAppSession): Promise<void> {
    const authPath = `./auth_info_baileys/${providerId}_${slotId}`;
    
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
          await storage.updateSlot(slotId, { whatsappConnected: false });

          if (shouldReconnect) {
            setTimeout(() => this.connectSocket(providerId, slotId, session), 5000);
          } else {
            this.sessions.delete(this.sessionKey(providerId, slotId));
            await this.cleanAuthFiles(providerId, slotId);
            console.log(`[WA-BAILEYS] Auth files cleaned for provider: ${providerId}, slot: ${slotId}. Ready for new QR.`);
          }
        } else if (connection === "open") {
          session.connected = true;
          session.qrCode = null;
          
          const user = socket.user;
          session.phoneNumber = user?.id?.split(":")[0] || user?.id?.split("@")[0] || null;
          
          console.log(`[WA-BAILEYS] Connected: providerId=${providerId}, slotId=${slotId}, phone=${session.phoneNumber}`);
          
          await storage.updateSlot(slotId, { whatsappConnected: true });
        }
      });

      socket.ev.on("messages.upsert", async (m) => {
        if (m.type !== "notify") return;

        for (const msg of m.messages) {
          if (!msg.message || msg.key.fromMe) continue;
          await this.handleIncomingMessage(providerId, slotId, msg, socket);
        }
      });

    } catch (error: any) {
      console.error(`[WA-BAILEYS] Error initializing for provider ${providerId}:`, error?.message);
    }
  }

  async handleIncomingMessage(
    providerId: string, 
    slotId: string,
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
        await this.sendMessage(providerId, slotId, clientPhone, "cc! je suis indisponible pour le moment, mais laisse ton message et je te repondrai plus tard");
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
      await this.sendMessage(providerId, slotId, clientPhone, "desole, je ne peux plus te donner de rdv. tu as rate trop de rdv sans prevenir.");
      return;
    }

    const blacklisted = await storage.isBlacklisted(clientPhone);
    if (blacklisted) return;

    const state = await this.loadState(providerId, slotId, clientPhone);
    const nowUtc = new Date();
    
    const upcomingAppointment = await storage.getNextClientAppointment(providerId, clientPhone, slotId);
    
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const recentlyBooked = state.lastBookingAt && state.lastBookingAt > twoHoursAgo;
    const hasUpcomingAppointment = !!upcomingAppointment;
    const isPostBooking = hasUpcomingAppointment || !!recentlyBooked;
    
    const recentHistory = state.chatHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join("\n");
    
    const classified = await this.classifyIntent(content, state.detectedLanguage, recentHistory, isPostBooking);
    console.log(`[CLASSIFIER] intent=${classified.intent} confidence=${classified.confidence} entities=${JSON.stringify(classified.entities)}`);
    
    if (isPostBooking) {
      const postBookingResponse = await this.handlePostBookingMessage(
        providerId, clientPhone, content, state, profile, slotId, upcomingAppointment, classified
      );
      await this.sendMessage(providerId, slotId, clientPhone, postBookingResponse);
      return;
    }

    const response = await this.generateAIResponse(providerId, clientPhone, content, profile, slotId, classified);
    await this.sendMessage(providerId, slotId, clientPhone, response);
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

  private async handlePostBookingMessage(
    providerId: string,
    clientPhone: string,
    content: string,
    state: ConversationState,
    profile: any,
    slotId: string,
    upcomingAppointment: any | undefined,
    classified: ClassifiedIntent
  ): Promise<string> {
    const bookingTime = state.lastBookingTime || "ton rdv";
    const bookingDateStr = state.lastBookingDateStr || "";
    
    let displayTime = bookingDateStr || bookingTime;
    if (upcomingAppointment) {
      const aptTime = formatInTimeZone(new Date(upcomingAppointment.appointmentDate), BRUSSELS_TZ, "HH:mm");
      const aptDate = new Date(upcomingAppointment.appointmentDate);
      const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
      const isToday = format(aptDate, "yyyy-MM-dd") === format(nowBrussels, "yyyy-MM-dd");
      displayTime = isToday ? `aujourd'hui a ${aptTime}` : `a ${aptTime}`;
    }

    switch (classified.intent) {
      case "time_query":
        return `ton rdv est ${displayTime}. sois a l'heure.`;

      case "address_query":
      case "arrival": {
        const nowUtc = new Date();
        const slot = state.lastBookingSlotId ? await storage.getSlot(state.lastBookingSlotId) : null;
        const approx = slot?.addressApprox || state.lastBookingAddress || null;
        const exact = slot?.addressExact || null;
        
        if (upcomingAppointment) {
          const aptTime = new Date(upcomingAppointment.appointmentDate);
          const minutesUntil = (aptTime.getTime() - nowUtc.getTime()) / (1000 * 60);
          
          const isArrival = classified.intent === "arrival";
          
          if (minutesUntil <= 15 || isArrival) {
            const addr = exact || approx;
            if (addr) {
              return isArrival 
                ? `ok je t'attends. c'est ici: ${addr}. google maps.`
                : `c'est ici: ${addr}. google maps. arrive maintenant.`;
            } else {
              return `adresse pas configuree. jte l'envoi des que possible.`;
            }
          } else {
            if (approx) {
              const minutesText = Math.floor(minutesUntil);
              return `je suis vers ${approx}. le num exact je tenvoi 15min avant. rdv dans ${minutesText}min.`;
            } else {
              return `je tenvoi l'adresse 15min avant le rdv. sois pret a l'heure.`;
            }
          }
        } else {
          if (approx) {
            return `je suis vers ${approx}. l'adresse exacte je tenvoi 15min avant le rdv.`;
          } else {
            return `je tenvoi l'adresse 15min avant le rdv.`;
          }
        }
      }

      case "cancel_confirm": {
        if (upcomingAppointment) {
          await storage.updateAppointment(upcomingAppointment.id, { status: "cancelled" });
          await this.persistState(providerId, clientPhone, {
            ...state,
            lastBookingAt: null,
            lastBookingTime: null,
            lastBookingDateStr: null,
            lastBookingAddress: null,
          }, slotId);
          return `rdv annule. a la prochaine.`;
        }
        return `pas de rdv a annuler.`;
      }

      case "cancel_request":
        return `tu veux annuler ton rdv de ${displayTime}? reponds "oui annuler" pour confirmer.`;

      case "booking_confirm":
        return `tu as deja un rdv ${displayTime}. viens a l'heure. si tu veux annuler dis le clairement.`;

      case "reassurance":
      case "greeting": {
        const reassurances = [
          `j'ai bien recu. ton rdv est ${displayTime}. a toute.`,
          `c'est note. rdv ${displayTime}. sois a l'heure.`,
          `ok parfait. on se voit ${displayTime}.`,
        ];
        return reassurances[Math.floor(Math.random() * reassurances.length)];
      }

      case "price_query":
      case "extras_query":
        return `tu as deja un rdv ${displayTime}. on voit tout ca a ce moment la. sois a l'heure.`;

      default:
        return `j'ai bien recu ton message. ton rdv est confirme ${displayTime}. sois a l'heure.`;
    }
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
    slotId: string | null = null,
    classified?: ClassifiedIntent
  ): Promise<string> {
    let convState = await this.loadState(providerId, slotId!, clientPhone);
    
    let slot: any = null;
    if (slotId) {
      slot = await storage.getSlot(slotId);
    }
    const effectiveCustomInstructions = slot?.customInstructions || profile.customInstructions || null;
    const effectiveAddressApprox = slot?.addressApprox || profile.address || null;
    const effectiveAddressExact = slot?.addressExact || null;
    
    if (!slotId) {
      console.error("[WA-AI] slotId required for generateAIResponse");
      return "desole, erreur technique. reessaie plus tard.";
    }
    const basePrices = await storage.getBasePrices(providerId, slotId);
    const serviceExtras = await storage.getServiceExtras(providerId, slotId);
    const customExtras = await storage.getCustomExtras(providerId, slotId);
    const businessHours = await storage.getBusinessHours(providerId, slotId);
    const services = await storage.getServices(providerId);
    
    const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
    const today = nowBrussels;
    const tomorrow = addDays(today, 1);
    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours, slotId);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours, slotId);
    
    const intent = classified?.intent || "off_topic";
    const confidence = classified?.confidence || 0;
    
    const isTodayFull = todaySlots.length === 0;
    const isTomorrowFull = tomorrowSlots.length === 0;
    const hasTomorrowSlots = tomorrowSlots.length > 0;

    // === HARD GUARDS (run BEFORE intent routing, regardless of classified intent) ===
    
    // GUARD: "ce soir" / "aujourd'hui" when today is full
    const lowerUserMessage = userMessage.toLowerCase();
    const isTodayRequest = /ce soir|aujourdhui|aujourd'hui|maintenant|tout de suite/.test(lowerUserMessage);
    if (isTodayRequest && isTodayFull) {
      let response: string;
      if (hasTomorrowSlots) {
        response = `plus de dispo aujourd'hui. je suis libre demain. tu veux voir les horaires?`;
      } else {
        response = `desole je suis complete aujourd'hui et demain. contacte moi dans quelques jours.`;
      }
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return this.censorText(response);
    }

    // === DETERMINISTIC INTENT ROUTING — handle intents that don't need GPT ===
    
    // EXTRAS: Always deterministic from DB, never GPT-generated
    if (intent === "extras_query") {
      const response = await this.generateExtrasList(providerId, clientPhone, slotId);
      const disclaimer = "\nuniquement ce qui est liste. si c'est pas indique, je ne le fais pas.";
      const fullResponse = response + disclaimer;
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: fullResponse });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return this.censorText(fullResponse);
    }
    
    // PRICE: Deterministic price list
    if (intent === "price_query") {
      const response = await this.generatePriceList(providerId, slotId);
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return this.censorText(response);
    }
    
    // AVAILABILITY: Deterministic slot display
    if (intent === "availability") {
      if (isTodayFull && isTomorrowFull) {
        const response = `desole je suis complete pour les prochains jours. recontacte moi plus tard.`;
        convState.chatHistory.push({ role: "user", content: userMessage });
        convState.chatHistory.push({ role: "assistant", content: response });
        convState.offTopicCount = 0;
        await this.persistState(providerId, clientPhone, convState, slotId);
        return response;
      }
      const response = await this.generateAvailableSlots(providerId, clientPhone, services, businessHours);
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    
    // SERVICE TYPE: Deterministic routing
    if (intent === "service_type_private") {
      convState.type = "private";
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      const response = await this.generateDurationOptions(providerId, clientPhone, "private", slotId);
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    if (intent === "service_type_escort") {
      convState.type = "escort";
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      const response = await this.generateDurationOptions(providerId, clientPhone, "escort", slotId);
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    
    // DURATION CHOICE: Deterministic if type is already selected
    if (intent === "duration_choice" && convState.type) {
      const response = await this.handleDurationChoice(providerId, clientPhone, userMessage, convState.type, slotId);
      convState = await this.loadState(providerId, slotId!, clientPhone);
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    
    // SLOT SELECTION: Deterministic validation + direct booking creation
    if (intent === "slot_selection") {
      const slotNum = classified?.entities?.slotNumber;
      const slotTime = classified?.entities?.time;
      
      let resolvedTime: string | null = null;
      let isTomorrowBooking = false;
      
      if (slotNum && convState.slotMapping && convState.slotMapping[slotNum]) {
        const mappedSlot = convState.slotMapping[slotNum];
        isTomorrowBooking = mappedSlot.startsWith("DEMAIN:");
        resolvedTime = isTomorrowBooking ? mappedSlot.replace("DEMAIN:", "") : mappedSlot;
      } else if (slotTime) {
        if (todaySlots.includes(slotTime)) {
          resolvedTime = slotTime;
          isTomorrowBooking = false;
        } else if (tomorrowSlots.includes(slotTime)) {
          resolvedTime = slotTime;
          isTomorrowBooking = true;
        } else {
          const altSlots = todaySlots.length > 0 ? todaySlots.slice(0, 4) : tomorrowSlots.slice(0, 4);
          const response = altSlots.length > 0
            ? `desole ${slotTime} est pas dispo. voici ce qui reste: ${altSlots.join(", ")}`
            : `desole plus de dispo. recontacte moi plus tard.`;
          convState.chatHistory.push({ role: "user", content: userMessage });
          convState.chatHistory.push({ role: "assistant", content: response });
          convState.offTopicCount = 0;
          await this.persistState(providerId, clientPhone, convState, slotId);
          return response;
        }
      }
      
      if (resolvedTime) {
        return await this.createBookingDeterministic(
          providerId, clientPhone, resolvedTime, isTomorrowBooking,
          convState, profile, slotId, services, businessHours,
          effectiveAddressApprox
        );
      }
      // If no valid mapping found, fall through to GPT for natural handling
    }
    
    // PHOTO REQUEST: Deterministic redirect
    if (intent === "photo_request") {
      const externalUrl = profile.externalProfileUrl || "";
      const response = externalUrl 
        ? `regarde ici: ${externalUrl}. tu veux rdv?`
        : `pas de photos dispo. tu veux reserver un rdv?`;
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    
    // ADDRESS QUERY: Deterministic with T-15 rule (pre-booking = approx only)
    if (intent === "address_query") {
      const addr = effectiveAddressApprox;
      const response = addr
        ? `je suis vers ${addr}. l'adresse exacte je tenvoi 15min avant le rdv. tu veux reserver?`
        : `je tenvoi l'adresse apres confirmation du rdv. tu veux reserver?`;
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      convState.offTopicCount = 0;
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    
    // OFF-TOPIC: Progressive guardrails (deterministic)
    if (intent === "off_topic" && confidence >= 0.7) {
      convState.offTopicCount = (convState.offTopicCount || 0) + 1;
      let response: string;
      if (convState.offTopicCount <= 2) {
        response = "dis moi juste la duree ou l'heure que tu veux";
      } else {
        response = "tu veux reserver un rdv ?";
      }
      convState.chatHistory.push({ role: "user", content: userMessage });
      convState.chatHistory.push({ role: "assistant", content: response });
      await this.persistState(providerId, clientPhone, convState, slotId);
      return response;
    }
    
    // Reset off-topic counter for on-topic intents
    if (intent !== "off_topic" && convState.offTopicCount > 0) {
      convState.offTopicCount = 0;
    }
    
    // === GPT RESPONSE GENERATOR ===
    // For intents that need natural text: greeting, booking_confirm, slot_selection, 
    // reassurance, low-confidence, and general conversation flow
    
    const activePrices = basePrices.filter(p => p.active);
    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    
    const durationLabels: Record<number, string> = {
      15: "15min", 30: "30min", 45: "45min", 60: "1h", 90: "1h30", 120: "2h"
    };
    
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
    
    const customInstructions = effectiveCustomInstructions || "";
    const providerName = slot?.name || profile.businessName || "la prestataire";
    const fullPriceList = this.getFormattedPriceList(activePrices, activeExtras, activeCustom);
    
    let numberedSlots = "";
    const slotMapping: Record<number, string> = {};
    
    if (todaySlots.length > 0) {
      numberedSlots += "AUJOURD'HUI:\n";
      todaySlots.forEach((s, i) => {
        const num = i + 1;
        numberedSlots += `${num}. ${s}\n`;
        slotMapping[num] = s;
      });
    }
    if (tomorrowSlots.length > 0) {
      const offset = todaySlots.length;
      numberedSlots += `\nDEMAIN (${format(tomorrow, "EEEE d", { locale: fr })}):\n`;
      tomorrowSlots.forEach((s, i) => {
        const num = offset + i + 1;
        numberedSlots += `${num}. ${s}\n`;
        slotMapping[num] = `DEMAIN:${s}`;
      });
    }
    
    try {
      convState = await this.persistState(providerId, clientPhone, { ...convState, slotMapping }, slotId);
    } catch (dbError) {
      console.error("[WA-STATE] Failed to persist slotMapping:", dbError);
      return "desole bug interne. reessaie.";
    }
    
    const externalUrl = profile.externalProfileUrl || "";
    const todayFull = todaySlots.length === 0;
    const tomorrowAvailable = tomorrowSlots.length > 0;
    const ceSoirContext = todayFull && tomorrowAvailable 
      ? `\nSI CLIENT DIT "ce soir" ou "aujourd'hui": Reponds "plus de dispo aujourd'hui. je suis libre demain. tu veux voir les horaires?"` 
      : "";
    
    const intentHint = intent !== "off_topic" 
      ? `\nINTENT DETECTE: ${intent} (guide ta reponse vers cet objectif)`
      : "";
    
    const systemPrompt = `Tu es ${providerName}, un bot de reservation sur whatsapp. Tu es ferme mais humain.

MISSION: Vendre un service et prendre un RDV. Reste focuse sur ca.${intentHint}

HORS-SUJET:
Si le client pose des questions hors-sujet: redirige vers la reservation.
INTERDICTION de parler de ta nature de bot.

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
                
                // MESSAGE DE CONFIRMATION: Only approximate address, exact sent at T-15
                const bookedTime = formatInTimeZone(appointmentDate, BRUSSELS_TZ, "HH:mm");
                const resolvedAddress = effectiveAddressApprox || null;
                
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

  private async createBookingDeterministic(
    providerId: string,
    clientPhone: string,
    timeStr: string,
    isTomorrow: boolean,
    convState: ConversationState,
    profile: any,
    slotId: string,
    services: any[],
    businessHours: any[],
    effectiveAddressApprox: string | null
  ): Promise<string> {
    const [hourStr, minuteStr] = timeStr.split(":");
    const hour = parseInt(hourStr);
    const minute = parseInt(minuteStr);
    
    const nowUtc = new Date();
    const nowBrusselsBooking = toZonedTime(nowUtc, BRUSSELS_TZ);
    const targetBrusselsDate = isTomorrow ? addDays(nowBrusselsBooking, 1) : nowBrusselsBooking;
    const brusselsDateStr = formatInTimeZone(targetBrusselsDate, BRUSSELS_TZ, "yyyy-MM-dd");
    const appointmentDate = fromZonedTime(`${brusselsDateStr} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, BRUSSELS_TZ);
    
    if (appointmentDate <= nowUtc) {
      return "desole ce creneau est deja passe, choisis une autre heure stp";
    }
    
    const availableSlots = await this.getAvailableSlots(providerId, targetBrusselsDate, businessHours, slotId);
    const requestedTime = formatInTimeZone(appointmentDate, BRUSSELS_TZ, "HH:mm");
    
    if (!availableSlots.includes(requestedTime)) {
      if (availableSlots.length === 0) {
        return `desole plus de creneau ${isTomorrow ? "demain" : "aujourd'hui"}. recontacte moi plus tard.`;
      }
      return `desole ${requestedTime} n'est plus dispo. voici ce qui reste: ${availableSlots.slice(0, 4).join(", ")}`;
    }
    
    const activeServices = services.filter(s => s.active);
    let selectedServiceId = convState.serviceId;
    if (!selectedServiceId && activeServices.length > 0) {
      const service1h = activeServices.find(s => s.duration === 60);
      selectedServiceId = (service1h || activeServices[0]).id;
    }
    const selectedService = activeServices.find(s => s.id === selectedServiceId) || activeServices[0];
    
    try {
      const noteText = [
        convState.type ? `Type: ${convState.type}` : "",
        convState.extras.length > 0 ? `Extras: ${convState.extras.join(", ")}` : "",
      ].filter(Boolean).join(". ");
      
      await storage.createAppointment({
        providerId,
        slotId,
        serviceId: selectedService?.id || null,
        clientPhone,
        clientName: "",
        appointmentDate,
        duration: convState.duration || selectedService?.duration || 60,
        status: "confirmed",
        notes: noteText || "RDV automatique",
      });
      
      const bookedTime = formatInTimeZone(appointmentDate, BRUSSELS_TZ, "HH:mm");
      const bookingDateStr = isTomorrow ? `demain a ${bookedTime}` : `aujourd'hui a ${bookedTime}`;
      
      let aiResponse: string;
      if (effectiveAddressApprox) {
        aiResponse = `ok c confirmer pour ${bookedTime}. je suis ${effectiveAddressApprox}. regarde sur google maps. je tenvoi le num exact 15min avant. sois la.`;
      } else {
        aiResponse = `ok c confirmer pour ${bookedTime}. adresse pas configuree dans mon dashboard. jte l'envoi des que possible. sois a l'heure.`;
      }
      
      convState.chatHistory.push({ role: "user", content: `${timeStr}` });
      convState.chatHistory.push({ role: "assistant", content: aiResponse });
      
      await this.persistState(providerId, clientPhone, {
        ...convState,
        type: null,
        duration: null,
        basePrice: 0,
        extras: [],
        extrasTotal: 0,
        slotMapping: {},
        offTopicCount: 0,
        lastBookingAt: Date.now(),
        lastBookingAddress: effectiveAddressApprox,
        lastBookingSlotId: slotId,
        lastBookingTime: bookedTime,
        lastBookingDateStr: bookingDateStr,
      }, slotId);
      
      console.log(`[WA-DETERMINISTIC] Created appointment for ${clientPhone} at ${bookedTime}, slotId=${slotId}`);
      return this.censorText(aiResponse);
    } catch (error) {
      console.error("[WA-DETERMINISTIC] Error creating appointment:", error);
      return "desole y'a eu un bug, reessaie stp";
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
    const currentState = await this.loadState(providerId, slotId, clientPhone);
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

  private async generateTotalRecap(providerId: string, slotId: string, clientPhone: string): Promise<string> {
    // DB SINGLE SOURCE OF TRUTH: Load state from database
    const state = await this.loadState(providerId, slotId, clientPhone);
    
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
    const state = await this.loadState(providerId, slotId, clientPhone);
    
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
    const state = await this.loadState(providerId, slotId, clientPhone);
    
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

  async sendNoShowWarning(providerId: string, slotId: string, clientPhone: string): Promise<void> {
    const message = "desole, tu ne t'es pas presente... s'il te plait ne reserve que si tu es certain de venir. mon systeme bloque les numeros apres deux absences – si tu rates le prochain rdv, je ne pourrai plus te donner de creneau. on fait attention?";
    await this.sendMessage(providerId, slotId, clientPhone, message);
  }

  async sendNoShowBlock(providerId: string, slotId: string, clientPhone: string): Promise<void> {
    const message = "desole, tu as trop d'absences sans prevenir. ton numero est maintenant bloque definitivement et je ne pourrai plus te donner de rdv. prends soin de toi.";
    await this.sendMessage(providerId, slotId, clientPhone, message);
  }

  async sendMessage(providerId: string, slotId: string, to: string, message: string) {
    const session = this.sessions.get(this.sessionKey(providerId, slotId));
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

  getStatus(providerId: string, slotId: string): { connected: boolean; qrCode: string | null; phoneNumber: string | null } {
    const session = this.sessions.get(this.sessionKey(providerId, slotId));
    return {
      connected: session?.connected || false,
      qrCode: session?.qrCode || null,
      phoneNumber: session?.phoneNumber || null,
    };
  }

  async disconnect(providerId: string, slotId: string): Promise<void> {
    const key = this.sessionKey(providerId, slotId);
    const session = this.sessions.get(key);
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
    this.sessions.delete(key);
    await this.cleanAuthFiles(providerId, slotId);
    await storage.updateSlot(slotId, { whatsappConnected: false });
    console.log(`[WA-BAILEYS] Disconnected and cleaned for provider: ${providerId}, slot: ${slotId}`);
  }

  async refreshQR(providerId: string, slotId: string): Promise<void> {
    const key = this.sessionKey(providerId, slotId);
    const session = this.sessions.get(key);
    
    if (session?.connected) {
      console.log(`[WA-BAILEYS] Session already connected for provider: ${providerId}, slot: ${slotId}, skipping refresh`);
      return;
    }
    
    if (session?.socket) {
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore socket close errors
      }
    }
    
    this.sessions.delete(key);
    await this.cleanAuthFiles(providerId, slotId);
    
    console.log(`[WA-BAILEYS] Refreshing QR for provider: ${providerId}, slot: ${slotId}`);
    await this.initSession(providerId, slotId);
  }

  async forceReconnect(providerId: string, slotId: string): Promise<void> {
    console.log(`[WA-BAILEYS] Force reconnect requested for provider: ${providerId}, slot: ${slotId}`);
    
    const key = this.sessionKey(providerId, slotId);
    const session = this.sessions.get(key);
    
    if (session?.socket) {
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore socket close errors
      }
    }
    
    this.sessions.delete(key);
    await this.cleanAuthFiles(providerId, slotId);
    await storage.updateSlot(slotId, { whatsappConnected: false });
    
    await this.initSession(providerId, slotId);
    console.log(`[WA-BAILEYS] Force reconnect completed for provider: ${providerId}, slot: ${slotId}`);
  }

  async autoReconnectAll(): Promise<void> {
    try {
      const connectedSlots = await storage.getConnectedSlots();
      if (connectedSlots.length === 0) {
        console.log("[WA-BAILEYS] No previously connected slots to reconnect");
        return;
      }
      
      console.log(`[WA-BAILEYS] Auto-reconnecting ${connectedSlots.length} slot(s)...`);
      
      for (const slot of connectedSlots) {
        const authPath = `./auth_info_baileys/${slot.providerId}_${slot.id}`;
        if (!fs.existsSync(authPath)) {
          console.warn(`[WA-BAILEYS] No auth files for slot ${slot.name} (${slot.id}) — skipping, needs new QR scan`);
          await storage.updateSlot(slot.id, { whatsappConnected: false });
          continue;
        }
        
        const authFiles = fs.readdirSync(authPath);
        if (authFiles.length === 0) {
          console.warn(`[WA-BAILEYS] Empty auth dir for slot ${slot.name} (${slot.id}) — skipping`);
          await storage.updateSlot(slot.id, { whatsappConnected: false });
          continue;
        }
        
        try {
          console.log(`[WA-BAILEYS] Reconnecting slot: ${slot.name} (provider=${slot.providerId}, slot=${slot.id})`);
          await this.initSession(slot.providerId, slot.id);
        } catch (err: any) {
          console.error(`[WA-BAILEYS] Failed to reconnect slot ${slot.name}:`, err?.message);
          await storage.updateSlot(slot.id, { whatsappConnected: false });
        }
      }
      
      console.log("[WA-BAILEYS] Auto-reconnect complete");
    } catch (error) {
      console.error("[WA-BAILEYS] Auto-reconnect error:", error);
    }
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
