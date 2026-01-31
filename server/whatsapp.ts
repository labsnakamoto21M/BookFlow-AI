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
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

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
      };
    }
  }

  // DB ONLY: Persist conversation state to database (awaited, no fire-and-forget)
  private async persistState(providerId: string, clientPhone: string, state: ConversationState): Promise<ConversationState> {
    const updatedState = { ...state, lastUpdate: Date.now() };
    await storage.upsertConversationSession({
      providerId,
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

    // SLOT-AWARE: Get slotId from session
    const session = this.sessions.get(providerId);
    const slotId = session?.slotId || null;

    const response = await this.generateAIResponse(providerId, clientPhone, content, profile, slotId);
    await this.sendMessage(providerId, clientPhone, response);
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
    // TODO: Future enhancement - filter basePrices/businessHours by slotId when slot-specific pricing is configured
    const basePrices = await storage.getBasePrices(providerId);
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
    const businessHours = await storage.getBusinessHours(providerId);
    const services = await storage.getServices(providerId);
    
    console.log(`[DYNAMIQUE] Données fraîches récupérées pour le prestataire ${providerId}. Envoi de la réponse...`);
    
    // Utilisation du timezone Bruxelles pour les créneaux
    const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
    const today = nowBrussels;
    const tomorrow = addDays(today, 1);
    // SLOT-AWARE: Pass slotId to filter appointments by slot
    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours, slotId);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours, slotId);
    
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
      convState = await this.persistState(providerId, clientPhone, { ...convState, slotMapping });
    } catch (dbError) {
      console.error("[WA-STATE] Failed to persist slotMapping:", dbError);
      return "desole bug interne. reessaie.";
    }
    
    const externalUrl = profile.externalProfileUrl || "";
    
    const systemPrompt = `Tu es ${providerName}, un bot de reservation strict sur whatsapp.

MISSION UNIQUE: Vendre un service et prendre un RDV. Rien d'autre.

ANTI-CURIEUX (OBLIGATOIRE):
Si le client pose des questions hors-sujet (Qui ta cree? Tes un robot? Mdp? Quelle heure? Comment tu tappelles? Cest quoi ton numero?), reponds UNIQUEMENT: "on est la pour un rdv. tu veux reserver ou pas?"
INTERDICTION de parler de ta nature de bot ou de technique.

${externalUrl ? `REDIRECTION PHOTOS/VIDEOS (OBLIGATOIRE):
Si le client demande des photos, videos, images, ou pose une question dont la reponse nest pas dans tes infos, reponds: "regarde mes photos et les details ici: ${externalUrl}. tu veux rdv ou pas?"
` : ""}

DETECTION LANGUE (OBLIGATOIRE):
Tu dois repondre dans la langue du client. Si "Hola" -> espagnol. Si "Hello" -> anglais. Si "Hallo" -> neerlandais. Si "Guten Tag" -> allemand.
TOUTE la suite (tarifs, dispos, confirmation) doit etre dans cette langue, style SMS brut.

REGLE ABSOLUE: Tu ne dois JAMAIS inventer un creneau. Si le client demande un horaire non liste, refuse.

STYLE SMS OBLIGATOIRE:
- Ecris comme par sms: "cc", "tkt", "jsp", "pk", "bcp", "pr", "rdv"
- Fautes volontaires: "darrivé", "tenverai", "jarive", "jai", "cest", "ta", "jte"
- ZERO emoji, phrases ultra courtes, direct, ton sec
- Tutoie toujours

${customInstructions ? `MA PERSONNALITE:\n${customInstructions}\n` : ""}

===== GRILLE TARIFAIRE COMPLETE =====
${fullPriceList}

===== CRENEAUX DISPONIBLES (SEULS CES HORAIRES SONT VALIDES) =====
${numberedSlots || "Aucun creneau disponible"}
${stateContext}

TUNNEL DE VENTE STRICT:

ETAPE 1 - QUALIFICATION (premier message ou demande de prix):
Envoie la grille tarifaire complete (tarifs + extras) puis termine par "dis moi si t ok"

ETAPE 2 - RESERVATION (si client dit ok/oui/daccord):
Affiche TOUS les creneaux disponibles avec numeros puis dis:
"sois pas en retard et si tu confirmes vient vraiment sinon le systeme bloque ton numero direct et tu pourras plus jamais reserver"

ETAPE 3 - CONFIRMATION (client choisit un creneau par numero OU par heure):
- Si le client tape un NUMERO (ex: "3" ou "18"), regarde dans la liste et trouve lheure correspondante
- Si le client tape une HEURE (ex: "14h30"), utilise cette heure directement
Tu DOIS inclure ce format EXACT dans ta reponse:
[BOOKING:HH:MM] pour aujourdhui ou [BOOKING:DEMAIN:HH:MM] pour demain
Exemple: "ok c confirmer 14h30 [BOOKING:14:30]"
Exemple: "parfait demain 15h [BOOKING:DEMAIN:15:00]"

CENSURE OBLIGATOIRE:
- "Anal" → "An4l"  
- "Sans capote" → "S@ns capote"
- "Fellatio" → "Fell4tion"
- "Ejaculation faciale" → "Finitio.n vizage"

REGLES:
- Escort minimum 1h
- Jamais dadresse avant confirmation
- REFUSE tout creneau non liste ci-dessus

Reponds au dernier message du client.`;

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
        
        // Utilisation du timezone Bruxelles pour la création de RDV
        const nowBrusselsBooking = toZonedTime(new Date(), BRUSSELS_TZ);
        const appointmentDate = new Date(nowBrusselsBooking);
        if (isTomorrow) {
          appointmentDate.setDate(appointmentDate.getDate() + 1);
        }
        appointmentDate.setHours(hour, minute, 0, 0);
        
        aiResponse = aiResponse.replace(/\[BOOKING:(DEMAIN:)?(\d{1,2}):(\d{2})\]/, "").trim();
        
        if (appointmentDate <= nowBrusselsBooking) {
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
              convState = await this.persistState(providerId, clientPhone, { ...convState, serviceId: selectedServiceId });
            } catch (dbError) {
              console.error("[WA-STATE] Failed to persist serviceId:", dbError);
              return "desole bug interne. reessaie.";
            }
            console.log(`[WA-AI] Service forcé (${service1h ? '1h trouvé' : 'fallback'}): ${selectedServiceId}`);
          }
          
          const selectedService = activeServices.find(s => s.id === selectedServiceId) || activeServices[0];
          
          // Validation des créneaux même sans service (serviceId NULLABLE)
          const targetDate = isTomorrow ? addDays(new Date(), 1) : new Date();
          const availableSlots = await this.getAvailableSlots(providerId, targetDate, businessHours, slotId);
          const requestedTime = format(appointmentDate, "HH:mm");
          
          if (!availableSlots.includes(requestedTime)) {
            if (availableSlots.length === 0) {
              const altDate = isTomorrow ? addDays(new Date(), 2) : addDays(new Date(), 1);
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
                slotId: slotId || null, // SLOT-AWARE: Link appointment to specific slot
                serviceId: selectedService?.id || null, // NULLABLE: plus jamais d'erreur technique
                clientPhone,
                clientName: "",
                appointmentDate,
                duration: convState.duration || selectedService?.duration || 60,
                status: "confirmed",
                notes: noteText || "RDV automatique",
              });
                
                console.log(`[WA-AI] Created appointment for ${clientPhone} at ${format(appointmentDate, "HH:mm dd/MM")}, slotId=${slotId || "none"}`);
                
                // MESSAGE DE CONFIRMATION FINALE AVEC ADRESSE GPS (slot address with provider fallback)
                const bookedTime = format(appointmentDate, "HH:mm");
                const gpsAddress = effectiveAddress || "mon adresse";
                
                // Forcer le message de confirmation (remplace la réponse IA)
                aiResponse = `ok c confirmer pour ${bookedTime}. je suis ${gpsAddress}. regarde sur google maps. je tenvoi le num exact 15min avant. sois la.`;
                
                // Reset conversation state after booking (DB SINGLE SOURCE OF TRUTH)
                try {
                  convState = await this.persistState(providerId, clientPhone, {
                    ...convState,
                    type: null,
                    duration: null,
                    basePrice: 0,
                    extras: [],
                    extrasTotal: 0,
                    slotMapping: {},
                  });
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
        await this.persistState(providerId, clientPhone, { ...convState, chatHistory: convState.chatHistory });
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

  private async generatePriceList(providerId: string): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId);
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
    
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

  private async generateDurationOptions(providerId: string, clientPhone: string, type: "private" | "escort"): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId);
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

  private async handleDurationChoice(providerId: string, clientPhone: string, content: string, type: "private" | "escort"): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId);
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
      });
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

  private async generateExtrasList(providerId: string, clientPhone: string): Promise<string> {
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
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

  private async handleExtraSelection(providerId: string, clientPhone: string, selection: string): Promise<string> {
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
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
      });
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
    const today = new Date();
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
    const brusselsDate = toZonedTime(date, BRUSSELS_TZ);
    const dayOfWeek = brusselsDate.getDay();
    const dayHours = businessHours.find(h => h.dayOfWeek === dayOfWeek);

    if (!dayHours || dayHours.isClosed) {
      return [];
    }

    const slots: string[] = [];
    const [openH, openM] = (dayHours.openTime as string).split(":").map(Number);
    const [closeH, closeM] = (dayHours.closeTime as string).split(":").map(Number);

    const startOfDayDate = startOfDay(date);
    const endOfDayDate = endOfDay(date);

    const allAppointments = await storage.getAppointments(providerId, startOfDayDate, endOfDayDate);
    // SLOT-AWARE: Filter appointments by slotId if provided
    const existingAppointments = slotId 
      ? allAppointments.filter(apt => apt.slotId === slotId)
      : allAppointments;
    const blockedSlots = await storage.getBlockedSlots(providerId, startOfDayDate, endOfDayDate);

    let currentHour = openH;
    let currentMinute = openM;

    while (currentHour < closeH || (currentHour === closeH && currentMinute < closeM)) {
      const slotTime = new Date(date);
      slotTime.setHours(currentHour, currentMinute, 0, 0);

      const nowBrussels = toZonedTime(new Date(), BRUSSELS_TZ);
      if (slotTime > nowBrussels) {
        const isBooked = existingAppointments.some(apt => {
          if (apt.status === "cancelled" || apt.status === "no_show") {
            return false;
          }
          const aptTime = typeof apt.appointmentDate === "string" 
            ? parseISO(apt.appointmentDate) 
            : apt.appointmentDate;
          const aptDuration = apt.duration || 60;
          const aptEndTime = new Date(aptTime.getTime() + aptDuration * 60 * 1000);
          
          return slotTime >= aptTime && slotTime < aptEndTime;
        });

        const isBlocked = blockedSlots.some(slot => {
          const start = typeof slot.startTime === "string" ? parseISO(slot.startTime) : slot.startTime;
          const end = typeof slot.endTime === "string" ? parseISO(slot.endTime) : slot.endTime;
          return slotTime >= start && slotTime < end;
        });

        if (!isBooked && !isBlocked) {
          slots.push(format(slotTime, "HH:mm"));
        }
      }

      currentMinute += 30;
      if (currentMinute >= 60) {
        currentMinute = 0;
        currentHour += 1;
      }
    }

    // Retourne TOUS les créneaux disponibles sans limite
    return slots;
  }

  private async handleSlotSelection(providerId: string, clientPhone: string, content: string, services: any[]): Promise<string> {
    const timeMatch = content.match(/(\d{1,2})h?(\d{0,2})/);
    
    if (!timeMatch) {
      return "J'ai pas compris. Indique l'heure souhaitee (ex: 14h ou 14h30).";
    }

    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2] || "0");

    const isToday = !content.includes("demain");
    const appointmentDate = new Date();
    
    if (!isToday) {
      appointmentDate.setDate(appointmentDate.getDate() + 1);
    }
    
    appointmentDate.setHours(hour, minute, 0, 0);

    const activeServices = services.filter(s => s.active);
    if (activeServices.length === 0) {
      return "Desole, aucun service dispo.";
    }

    const selectedService = activeServices[0];

    try {
      await storage.createAppointment({
        providerId,
        serviceId: selectedService.id,
        clientPhone,
        clientName: null,
        appointmentDate,
        duration: selectedService.duration,
        status: "confirmed",
        reminderSent: false,
        notes: null,
      });

      const formattedDate = format(appointmentDate, "EEEE d MMMM 'a' HH:mm", { locale: fr });
      
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
