import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode";
import { storage } from "./storage";
import { format, addDays, startOfDay, endOfDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import cron from "node-cron";
import fs from "fs";
import path from "path";

type ClientType = InstanceType<typeof Client>;

interface WhatsAppSession {
  client: ClientType;
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
}

class WhatsAppManager {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private conversationStates: Map<string, ConversationState> = new Map();
  private awayMessageSent: Map<string, number> = new Map(); // Track AWAY messages sent to avoid spam

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

  async initSession(providerId: string): Promise<WhatsAppSession> {
    if (this.sessions.has(providerId)) {
      return this.sessions.get(providerId)!;
    }

    const client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: providerId,
        dataPath: "./.wwebjs_auth"
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--disable-extensions",
          "--single-process",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--disable-translate",
          "--hide-scrollbars",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-default-browser-check",
          "--disable-features=TranslateUI",
          "--disable-component-extensions-with-background-pages",
          "--disable-ipc-flooding-protection",
          "--disable-renderer-backgrounding",
          "--force-color-profile=srgb",
          "--disable-backgrounding-occluded-windows",
        ],
      },
    });

    // Block media requests to reduce RAM usage by 30-50%
    client.on("ready", async () => {
      try {
        const page = await (client as any).pupPage;
        if (page) {
          await page.setRequestInterception(true);
          page.on("request", (req: any) => {
            const resourceType = req.resourceType();
            if (["image", "media", "font", "stylesheet"].includes(resourceType)) {
              req.abort();
            } else {
              req.continue();
            }
          });
        }
      } catch (err) {
        // Request interception setup failed, continue without it
      }
    });

    const now = Date.now();
    const session: WhatsAppSession = {
      client,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      providerId,
      createdAt: now,
      lastRestart: now,
    };

    this.sessions.set(providerId, session);

    client.on("qr", async (qr) => {
      session.qrCode = await qrcode.toDataURL(qr);
      session.connected = false;
    });

    client.on("ready", async () => {
      session.connected = true;
      session.qrCode = null;
      const info = client.info;
      session.phoneNumber = info?.wid?.user || null;
      await storage.updateProviderProfile(providerId, { whatsappConnected: true });
    });

    client.on("authenticated", () => {
      // Authenticated successfully
    });

    client.on("disconnected", async (reason) => {
      session.connected = false;
      session.phoneNumber = null;
      await storage.updateProviderProfile(providerId, { whatsappConnected: false });
    });

    client.on("message", async (msg) => {
      await this.handleIncomingMessage(providerId, msg);
    });

    // Listen for all messages (including outgoing) to detect !noshow command
    client.on("message_create", async (msg) => {
      await this.handleMessageCreate(providerId, msg, client);
    });

    try {
      await client.initialize();
    } catch (error) {
      // Failed to initialize - will retry on next connection attempt
    }

    return session;
  }

  // Handle outgoing messages - !noshow command removed (handled via Agenda UI instead)
  async handleMessageCreate(providerId: string, msg: any, client: any) {
    // No command processing from provider messages anymore
    // No-show is now handled via the Agenda interface
  }

  async handleIncomingMessage(providerId: string, msg: any) {
    // FILTER 1: Ignore all group messages (group chats end with @g.us)
    if (msg.from.endsWith("@g.us")) {
      return;
    }

    const clientPhone = msg.from.replace("@c.us", "");

    // Get provider profile first to check availability mode
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
      
      // Only send AWAY message once per hour per client
      if (!lastAwaySent || lastAwaySent < oneHourAgo) {
        await this.sendMessage(providerId, clientPhone, "cc! je suis indisponible pour le moment, mais laisse ton message et je te repondrai plus tard");
        this.awayMessageSent.set(awayKey, Date.now());
      }
      return;
    }

    // FILTER 3: Check if sender is a dangerous client (2+ safety reports) - silent ignore
    const isDangerous = await storage.isDangerousClient(clientPhone);
    if (isDangerous) {
      return; // Silent ignore for dangerous clients
    }

    // FILTER 4: Check if sender is a known contact - if so, stay silent
    try {
      const contact = await msg.getContact();
      if (contact && contact.isMyContact) {
        return;
      }
    } catch (error) {
      // Continue if contact check fails
    }

    const content = msg.body.toLowerCase().trim();

    // GDPR: No message content logging - messages are processed ephemerally

    const services = await storage.getServices(providerId);
    const businessHours = await storage.getBusinessHours(providerId);

    // Check if client is personally blocked by this provider
    const isBlocked = await storage.isBlockedByProvider(providerId, clientPhone);
    if (isBlocked) {
      return;
    }

    // Check client reliability score - if 2+ no-shows, refuse booking
    const reliability = await storage.getClientReliability(clientPhone);
    if (reliability && reliability.noShowTotal && reliability.noShowTotal >= 2) {
      await this.sendMessage(providerId, clientPhone, "desole, je ne peux plus te donner de rdv. tu as rate trop de rdv sans prevenir.");
      return;
    }

    // Check if client is in shared blacklist (continue but be cautious)
    await storage.isBlacklisted(clientPhone);

    let response = "";

    // Get conversation state
    const convState = this.getConversationState(providerId, clientPhone);

    // Handle different types of messages
    if (this.isGreeting(content)) {
      response = this.generateGreeting(profile.businessName);
    } else if (this.isPriceQuery(content)) {
      response = await this.generatePriceList(providerId);
    } else if (this.isPrivateChoice(content)) {
      this.updateConversationState(providerId, clientPhone, { type: "private", duration: null, basePrice: 0 });
      response = await this.generateDurationOptions(providerId, clientPhone, "private");
    } else if (this.isEscortChoice(content)) {
      this.updateConversationState(providerId, clientPhone, { type: "escort", duration: null, basePrice: 0 });
      response = await this.generateDurationOptions(providerId, clientPhone, "escort");
    } else if (this.isDurationChoice(content) && convState.type) {
      response = await this.handleDurationChoice(providerId, clientPhone, content, convState.type);
    } else if (this.isExtrasQuery(content)) {
      response = await this.generateExtrasList(providerId, clientPhone);
    } else if (content.startsWith("+") && content.length > 1) {
      response = await this.handleExtraSelection(providerId, clientPhone, content.slice(1).trim());
    } else if (content === "total" || content === "recap") {
      response = this.generateTotalRecap(providerId, clientPhone);
    } else if (this.isServiceQuery(content)) {
      response = this.generateServiceInfo(services);
    } else if (this.isBookingRequest(content)) {
      response = await this.generateAvailableSlots(providerId, clientPhone, services, businessHours);
    } else if (this.isSlotSelection(content)) {
      response = await this.handleSlotSelection(providerId, clientPhone, content, services);
    } else {
      response = this.generateDefaultResponse(profile.businessName);
    }

    // Send response
    await this.sendMessage(providerId, clientPhone, response);
  }

  private isGreeting(content: string): boolean {
    const greetings = ["bonjour", "bonsoir", "salut", "hello", "hi", "coucou", "hey"];
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
    // Check if it looks like a time selection (e.g., "10h", "14h30", "demain 15h")
    const timePattern = /\d{1,2}h?\d{0,2}/;
    return timePattern.test(content);
  }

  private isDurationChoice(content: string): boolean {
    const durationKeywords = ["15", "30", "45", "60", "90", "120", "1h", "2h"];
    return durationKeywords.some(k => content.includes(k));
  }

  // Censure anti-ban: remplace les termes sensibles
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
      result = result.replace(new RegExp(original, 'g'), replacement);
    }
    return result;
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
      // Escort uniquement pour >= 60 min
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
    
    // Escort uniquement pour >= 60 min
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
    
    // Escort uniquement pour >= 60 min
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
    const state = this.getConversationState(providerId, clientPhone);

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

    // Get existing appointments and blocked slots
    const existingAppointments = await storage.getAppointments(providerId, startOfDayDate, endOfDayDate);
    const blockedSlots = await storage.getBlockedSlots(providerId, startOfDayDate, endOfDayDate);

    // Generate 30-minute slots
    let currentHour = openH;
    let currentMinute = openM;

    while (currentHour < closeH || (currentHour === closeH && currentMinute < closeM)) {
      const slotTime = new Date(date);
      slotTime.setHours(currentHour, currentMinute, 0, 0);

      // Check if slot is available (not in past, not booked, not blocked)
      const now = new Date();
      if (slotTime > now) {
        const isBooked = existingAppointments.some(apt => {
          const aptTime = typeof apt.appointmentDate === 'string' 
            ? parseISO(apt.appointmentDate) 
            : apt.appointmentDate;
          return Math.abs(aptTime.getTime() - slotTime.getTime()) < 30 * 60 * 1000;
        });

        const isBlocked = blockedSlots.some(slot => {
          const start = typeof slot.startTime === 'string' ? parseISO(slot.startTime) : slot.startTime;
          const end = typeof slot.endTime === 'string' ? parseISO(slot.endTime) : slot.endTime;
          return slotTime >= start && slotTime < end;
        });

        if (!isBooked && !isBlocked) {
          slots.push(format(slotTime, "HH:mm"));
        }
      }

      // Move to next 30-minute slot
      currentMinute += 30;
      if (currentMinute >= 60) {
        currentMinute = 0;
        currentHour += 1;
      }
    }

    return slots.slice(0, 6); // Max 6 slots to show
  }

  private async handleSlotSelection(providerId: string, clientPhone: string, content: string, services: any[]): Promise<string> {
    // Simple slot booking logic
    const timeMatch = content.match(/(\d{1,2})h?(\d{0,2})/);
    
    if (!timeMatch) {
      return "Je n'ai pas compris. Veuillez indiquer l'heure souhaitée (ex: 14h ou 14h30).";
    }

    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2] || "0");

    // Determine if it's today or tomorrow based on content
    const isToday = !content.includes("demain");
    const appointmentDate = new Date();
    
    if (!isToday) {
      appointmentDate.setDate(appointmentDate.getDate() + 1);
    }
    
    appointmentDate.setHours(hour, minute, 0, 0);

    // Default to first active service if only one
    const activeServices = services.filter(s => s.active);
    if (activeServices.length === 0) {
      return "Désolé, aucun service n'est disponible.";
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

  // Send no-show warning message to client (called from Agenda UI)
  async sendNoShowWarning(providerId: string, clientPhone: string): Promise<void> {
    const message = "coucou, je vois que tu n'es pas venu... s'il te plait, ne reserve que si tu es certain de venir. mon systeme bloque les numeros apres deux absences, donc si tu rates le prochain, je ne pourrai plus te donner de rdv. on fait attention?";
    await this.sendMessage(providerId, clientPhone, message);
  }

  async sendMessage(providerId: string, to: string, message: string) {
    const session = this.sessions.get(providerId);
    if (!session?.connected) {
      return;
    }

    try {
      const chatId = to.includes("@c.us") ? to : `${to}@c.us`;
      // Apply censorship to ALL outgoing messages for anti-ban protection
      const censoredMessage = this.censorText(message);
      await session.client.sendMessage(chatId, censoredMessage);
      // GDPR: No message content logging - messages are processed ephemerally
    } catch (error) {
      // Silent fail for production
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
    if (session) {
      try {
        await session.client.logout();
        await session.client.destroy();
      } catch (error) {
        // Silent fail on disconnect
      }
      this.sessions.delete(providerId);
    }
    await storage.updateProviderProfile(providerId, { whatsappConnected: false });
  }

  async refreshQR(providerId: string): Promise<void> {
    const session = this.sessions.get(providerId);
    if (session && !session.connected) {
      try {
        await session.client.destroy();
      } catch (error) {
        // Ignore
      }
      this.sessions.delete(providerId);
      await this.initSession(providerId);
    }
  }

  // Auto-restart session to prevent memory leaks (every 3 days)
  private async autoRestartSession(providerId: string): Promise<void> {
    const session = this.sessions.get(providerId);
    if (!session) return;

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const timeSinceRestart = Date.now() - session.lastRestart;

    if (timeSinceRestart >= threeDaysMs && session.connected) {
      console.log(`[WhatsApp] Auto-restarting session for provider ${providerId} (3-day cycle)`);
      try {
        await session.client.destroy();
        this.sessions.delete(providerId);
        // Clear conversation states for this provider
        const convKeys = Array.from(this.conversationStates.keys());
        for (const key of convKeys) {
          if (key.startsWith(`${providerId}:`)) {
            this.conversationStates.delete(key);
          }
        }
        // Reinitialize after a short delay
        setTimeout(() => this.initSession(providerId), 5000);
      } catch (error) {
        console.error(`[WhatsApp] Error during auto-restart for ${providerId}:`, error);
      }
    }
  }

  // Check all sessions and restart if needed
  async checkAndRestartSessions(): Promise<void> {
    const sessionEntries = Array.from(this.sessions.entries());
    for (const [providerId] of sessionEntries) {
      await this.autoRestartSession(providerId);
    }
  }

  // Graceful shutdown - destroy all sessions properly
  async gracefulShutdown(): Promise<void> {
    console.log("[WhatsApp] Graceful shutdown initiated...");
    const shutdownPromises: Promise<void>[] = [];

    const sessionEntries = Array.from(this.sessions.entries());
    for (const [providerId, session] of sessionEntries) {
      shutdownPromises.push(
        (async () => {
          try {
            await session.client.destroy();
            console.log(`[WhatsApp] Session ${providerId} destroyed`);
          } catch (error) {
            console.error(`[WhatsApp] Error destroying session ${providerId}:`, error);
          }
        })()
      );
    }

    await Promise.all(shutdownPromises);
    this.sessions.clear();
    this.conversationStates.clear();
    this.awayMessageSent.clear();
    console.log("[WhatsApp] All sessions cleaned up");
  }

  // Clean temporary files (except essential auth files)
  async cleanupTempFiles(): Promise<void> {
    const authPath = "./.wwebjs_auth";
    const essentialFiles = ["session"];

    try {
      if (!fs.existsSync(authPath)) return;

      const sessionDirs = fs.readdirSync(authPath);
      for (const dir of sessionDirs) {
        const dirPath = path.join(authPath, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;

        // Clean cache and temp files, keep auth data
        const cleanDirs = ["Cache", "Code Cache", "GPUCache", "Service Worker"];
        for (const cleanDir of cleanDirs) {
          const cleanPath = path.join(dirPath, "Default", cleanDir);
          if (fs.existsSync(cleanPath)) {
            try {
              fs.rmSync(cleanPath, { recursive: true, force: true });
              console.log(`[WhatsApp] Cleaned: ${cleanPath}`);
            } catch (err) {
              // Ignore errors during cleanup
            }
          }
        }
      }
    } catch (error) {
      console.error("[WhatsApp] Error during temp cleanup:", error);
    }
  }

  // Clear expired conversation states (30 min timeout)
  cleanupExpiredConversations(): void {
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1000;

    const convEntries = Array.from(this.conversationStates.entries());
    for (const [key, state] of convEntries) {
      if (now - state.lastUpdate > thirtyMinutes) {
        this.conversationStates.delete(key);
      }
    }

    // Also clean expired away messages (1 hour)
    const oneHour = 60 * 60 * 1000;
    const awayEntries = Array.from(this.awayMessageSent.entries());
    for (const [key, timestamp] of awayEntries) {
      if (now - timestamp > oneHour) {
        this.awayMessageSent.delete(key);
      }
    }
  }

  // Initialize maintenance cron jobs
  initMaintenanceJobs(): void {
    // Daily cleanup at 4:00 AM
    cron.schedule("0 4 * * *", async () => {
      console.log("[WhatsApp] Running daily maintenance (4 AM)...");
      await this.cleanupTempFiles();
      this.cleanupExpiredConversations();
    });

    // Check sessions every 6 hours for auto-restart
    cron.schedule("0 */6 * * *", async () => {
      console.log("[WhatsApp] Checking sessions for auto-restart...");
      await this.checkAndRestartSessions();
    });

    // Cleanup conversations every 15 minutes
    cron.schedule("*/15 * * * *", () => {
      this.cleanupExpiredConversations();
    });

    console.log("[WhatsApp] Maintenance jobs initialized");
  }
}

export const whatsappManager = new WhatsAppManager();

// Initialize maintenance jobs on startup
whatsappManager.initMaintenanceJobs();

// Handle process signals for graceful shutdown
process.on("SIGTERM", async () => {
  await whatsappManager.gracefulShutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await whatsappManager.gracefulShutdown();
  process.exit(0);
});
