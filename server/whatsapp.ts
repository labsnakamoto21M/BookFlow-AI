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
import cron from "node-cron";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "",
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
  createdAt: number;
  lastRestart: number;
}

interface ConversationState {
  type: "private" | "escort" | null;
  duration: number | null;
  basePrice: number;
  extras: string[];
  extrasTotal: number;
  lastUpdate: number;
  chatHistory: ChatMessage[];
}

const logger = pino({ level: "silent" });

class WhatsAppManager {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private conversationStates: Map<string, ConversationState> = new Map();
  private awayMessageSent: Map<string, number> = new Map();

  private getConversationKey(providerId: string, clientPhone: string): string {
    return `${providerId}:${clientPhone}`;
  }

  private getConversationState(providerId: string, clientPhone: string): ConversationState {
    const key = this.getConversationKey(providerId, clientPhone);
    const state = this.conversationStates.get(key);
    
    if (!state || Date.now() - state.lastUpdate > 30 * 60 * 1000) {
      const newState: ConversationState = {
        type: null,
        duration: null,
        basePrice: 0,
        extras: [],
        extrasTotal: 0,
        lastUpdate: Date.now(),
        chatHistory: [],
      };
      this.conversationStates.set(key, newState);
      return newState;
    }
    
    return state;
  }

  private updateConversationState(providerId: string, clientPhone: string, updates: Partial<ConversationState>): void {
    const key = this.getConversationKey(providerId, clientPhone);
    const state = this.getConversationState(providerId, clientPhone);
    this.conversationStates.set(key, { ...state, ...updates, lastUpdate: Date.now() });
  }

  private clearConversationState(providerId: string, clientPhone: string): void {
    const key = this.getConversationKey(providerId, clientPhone);
    this.conversationStates.delete(key);
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
          console.log(`[WA-BAILEYS] Connected successfully for provider: ${providerId}`);
          session.connected = true;
          session.qrCode = null;
          
          const user = socket.user;
          session.phoneNumber = user?.id?.split(":")[0] || user?.id?.split("@")[0] || null;
          
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

    const response = await this.generateAIResponse(providerId, clientPhone, content, profile);
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

  private async generateAIResponse(
    providerId: string,
    clientPhone: string,
    userMessage: string,
    profile: any
  ): Promise<string> {
    const convState = this.getConversationState(providerId, clientPhone);
    
    const basePrices = await storage.getBasePrices(providerId);
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
    const businessHours = await storage.getBusinessHours(providerId);
    const services = await storage.getServices(providerId);
    
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours);
    
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
    
    const customInstructions = profile.customInstructions || "";
    const providerName = profile.businessName || "la prestataire";
    
    const systemPrompt = `Tu es l'assistante WhatsApp de ${providerName}, une masseuse/escort.

STYLE DE COMMUNICATION OBLIGATOIRE:
- Ecris comme par SMS: phrases courtes, pas d'emoji, quelques fautes/raccourcis ok
- Tutoie le client
- Sois directe et naturelle, pas formelle
- Quand tu proposes des options, utilise des numeros (1. 2. 3...)
- Ne repete pas tout le temps les memes infos

${customInstructions ? `INSTRUCTIONS PERSONNALISEES:\n${customInstructions}\n` : ""}

${priceContext}
${extrasContext}
${availContext}
${stateContext}

FONCTIONNALITES:
- Si le client demande les prix/tarifs, donne-lui la liste avec numeros
- Si le client choisit "prive" ou "escort", propose les durees
- Si le client choisit une duree, confirme et propose les extras
- Si le client veut un rdv, donne les creneaux dispo avec numeros
- Si le client choisit un creneau (ex: "14h" ou "3"), confirme le rdv

REGLES:
- Ne jamais donner d'adresse avant confirmation de rdv
- Escort minimum 1h
- Si le client semble dangereux ou irrespectueux, reste polie mais distante

Reponds UNIQUEMENT au dernier message du client.`;

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
        max_tokens: 300,
        temperature: 0.7,
      });
      
      const aiResponse = completion.choices[0]?.message?.content || "desole je ne comprends pas, peux-tu reformuler?";
      
      convState.chatHistory.push({ role: "assistant", content: aiResponse });
      this.updateConversationState(providerId, clientPhone, { chatHistory: convState.chatHistory });
      
      return aiResponse;
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

    this.updateConversationState(providerId, clientPhone, { 
      duration: selectedDuration, 
      basePrice: selectedPrice 
    });

    const label = durationLabels[selectedDuration] || `${selectedDuration}min`;
    const typeLabel = type === "private" ? "chez moi" : "deplacement";
    
    let response = `ok! ${typeLabel} ${label}: ${selectedPrice}e\n\n`;
    response += "tape *extras* pour ajouter des options\n";
    response += "tape *total* pour le recap\n";
    response += "tape *rdv* pour reserver";
    
    return response;
  }

  private generateTotalRecap(providerId: string, clientPhone: string): string {
    const state = this.getConversationState(providerId, clientPhone);
    
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
      response += `extras: ${state.extras.map(e => this.censorText(e)).join(", ")}\n`;
      response += `+ ${state.extrasTotal}e\n`;
    }
    
    response += `\ntotal: ${total}e\n\n`;
    response += "tape *rdv* pour reserver";
    
    return response;
  }

  private async generateExtrasList(providerId: string, clientPhone: string): Promise<string> {
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
    const state = this.getConversationState(providerId, clientPhone);
    
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
    const state = this.getConversationState(providerId, clientPhone);
    
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
    
    this.updateConversationState(providerId, clientPhone, {
      extras: newExtras,
      extrasTotal: newExtrasTotal,
    });

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

  private async getAvailableSlots(providerId: string, date: Date, businessHours: any[]): Promise<string[]> {
    const dayOfWeek = date.getDay();
    const dayHours = businessHours.find(h => h.dayOfWeek === dayOfWeek);

    if (!dayHours || dayHours.isClosed) {
      return [];
    }

    const slots: string[] = [];
    const [openH, openM] = (dayHours.openTime as string).split(":").map(Number);
    const [closeH, closeM] = (dayHours.closeTime as string).split(":").map(Number);

    const startOfDayDate = startOfDay(date);
    const endOfDayDate = endOfDay(date);

    const existingAppointments = await storage.getAppointments(providerId, startOfDayDate, endOfDayDate);
    const blockedSlots = await storage.getBlockedSlots(providerId, startOfDayDate, endOfDayDate);

    let currentHour = openH;
    let currentMinute = openM;

    while (currentHour < closeH || (currentHour === closeH && currentMinute < closeM)) {
      const slotTime = new Date(date);
      slotTime.setHours(currentHour, currentMinute, 0, 0);

      const now = new Date();
      if (slotTime > now) {
        const isBooked = existingAppointments.some(apt => {
          const aptTime = typeof apt.appointmentDate === "string" 
            ? parseISO(apt.appointmentDate) 
            : apt.appointmentDate;
          return Math.abs(aptTime.getTime() - slotTime.getTime()) < 30 * 60 * 1000;
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

    return slots.slice(0, 6);
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
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1000;

    const convEntries = Array.from(this.conversationStates.entries());
    for (const [key, state] of convEntries) {
      if (now - state.lastUpdate > thirtyMinutes) {
        this.conversationStates.delete(key);
      }
    }

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
