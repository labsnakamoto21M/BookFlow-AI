import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode";
import { storage } from "./storage";
import { format, addDays, startOfDay, endOfDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

type ClientType = InstanceType<typeof Client>;

interface WhatsAppSession {
  client: ClientType;
  qrCode: string | null;
  connected: boolean;
  phoneNumber: string | null;
  providerId: string;
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
          "--single-process"
        ],
      },
    });

    const session: WhatsAppSession = {
      client,
      qrCode: null,
      connected: false,
      phoneNumber: null,
      providerId,
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
      console.log(`WhatsApp connected for provider ${providerId}`);
    });

    client.on("authenticated", () => {
      console.log(`WhatsApp authenticated for provider ${providerId}`);
    });

    client.on("disconnected", async (reason) => {
      session.connected = false;
      session.phoneNumber = null;
      await storage.updateProviderProfile(providerId, { whatsappConnected: false });
      console.log(`WhatsApp disconnected for provider ${providerId}: ${reason}`);
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
      console.error(`Failed to initialize WhatsApp for provider ${providerId}:`, error);
    }

    return session;
  }

  // Handle outgoing messages from provider to detect !noshow command
  async handleMessageCreate(providerId: string, msg: any, client: any) {
    // Only process outgoing messages (from provider to client)
    if (!msg.fromMe) return;

    // Ignore group messages for !noshow command too
    const chatId = msg.to || msg.from;
    if (chatId.endsWith("@g.us")) return;
    
    const content = msg.body.trim();
    const clientPhone = chatId.replace("@c.us", "");
    
    // Check for !noshow command
    if (content.toLowerCase().includes("!noshow")) {
      try {
        // Increment no-show counter for this phone number
        const reliability = await storage.incrementNoShow(clientPhone, providerId);
        
        console.log(`No-show reported for ${clientPhone} by provider ${providerId}. Total: ${reliability.noShowTotal}`);
        
        // Try to delete the !noshow message so client doesn't see it
        try {
          await msg.delete(true); // Delete for everyone
          console.log(`Deleted !noshow message for ${clientPhone}`);
        } catch (deleteError) {
          console.log(`Could not delete message (may be too old): ${deleteError}`);
        }
        
        // Send confirmation to provider's own chat (private notification)
        // We'll use a workaround: send to the same chat but mark as system message
        // For now, just log it - the dashboard will show the signalement
        
      } catch (error) {
        console.error(`Error processing !noshow command:`, error);
      }
    }
  }

  async handleIncomingMessage(providerId: string, msg: any) {
    // FILTER 1: Ignore all group messages (group chats end with @g.us)
    if (msg.from.endsWith("@g.us")) {
      console.log(`Ignoring group message for provider ${providerId}`);
      return;
    }

    // FILTER 2: Check if sender is a known contact - if so, stay silent
    try {
      const contact = await msg.getContact();
      if (contact && contact.isMyContact) {
        console.log(`Known contact ${contact.pushname || contact.number} messaged provider ${providerId} - staying silent`);
        return;
      }
    } catch (error) {
      console.error(`Error checking contact status:`, error);
      // Continue processing if we can't determine contact status
    }

    const clientPhone = msg.from.replace("@c.us", "");
    const content = msg.body.toLowerCase().trim();

    // GDPR: No message content logging - messages are processed ephemerally

    // Get provider profile and services
    const profile = await storage.getProviderProfileById(providerId);
    if (!profile) return;

    const services = await storage.getServices(providerId);
    const businessHours = await storage.getBusinessHours(providerId);

    // Check if client is personally blocked by this provider
    const isBlocked = await storage.isBlockedByProvider(providerId, clientPhone);
    if (isBlocked) {
      console.log(`Blocked client ${clientPhone} tried to contact provider ${providerId} - ignoring`);
      return; // Don't respond to blocked clients
    }

    // Check client reliability score (alert info available via API, not logged)
    const reliability = await storage.getClientReliability(clientPhone);
    if (reliability && reliability.noShowTotal && reliability.noShowTotal > 0) {
      // GDPR: No message logging - reliability info is available via signalements API
      console.log(`No-show alert for provider ${providerId}: Client ${clientPhone} has ${reliability.noShowTotal} no-show(s)`);
    }

    // Check if client is in shared blacklist
    const blacklisted = await storage.isBlacklisted(clientPhone);
    if (blacklisted) {
      console.log(`Blacklisted client ${clientPhone} tried to contact provider ${providerId}`);
    }

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

  private generateGreeting(businessName: string): string {
    return `Bonjour! Bienvenue chez ${businessName}.\n\nJe suis votre assistant de reservation. Comment puis-je vous aider?\n\n[SERVICES] Tapez "services" pour voir nos prestations\n[PRIX] Tapez "prix" pour connaitre nos tarifs\n[RDV] Tapez "rdv" pour prendre rendez-vous`;
  }

  private async generatePriceList(providerId: string): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId);
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
    
    const activePrices = basePrices.filter(p => p.active);
    
    if (activePrices.length === 0) {
      return "Désolé, aucun tarif n'est configuré pour le moment.";
    }

    const durationLabels: Record<number, string> = {
      15: "15 min", 30: "30 min", 45: "45 min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    let response = "[TARIFS]\n\n";
    response += "[PRIVE] | [ESCORT]\n";
    response += "─────────────────\n";
    
    activePrices.forEach(price => {
      const label = durationLabels[price.duration] || `${price.duration} min`;
      const priv = price.pricePrivate ? (price.pricePrivate / 100) : 0;
      const esc = price.priceEscort ? (price.priceEscort / 100) : 0;
      response += `${label}: ${priv}€ | ${esc}€\n`;
    });

    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    
    if (activeExtras.length > 0 || activeCustom.length > 0) {
      response += "\n[EXTRAS]\n";
      activeExtras.forEach(extra => {
        const extraPrice = extra.price ? (extra.price / 100) : 0;
        response += `> ${extra.extraType}: +${extraPrice}EUR\n`;
      });
      activeCustom.forEach(extra => {
        const extraPrice = extra.price ? (extra.price / 100) : 0;
        response += `> ${extra.name}: +${extraPrice}EUR\n`;
      });
    }

    response += "\n[CMD] Tapez *prive* ou *escort* pour choisir le type";
    response += "\n[CMD] Tapez *rdv* pour voir les disponibilites";
    return response;
  }

  private async generateDurationOptions(providerId: string, clientPhone: string, type: "private" | "escort"): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId);
    const activePrices = basePrices.filter(p => p.active);
    
    if (activePrices.length === 0) {
      return "Desole, aucun tarif n'est disponible.";
    }

    const durationLabels: Record<number, string> = {
      15: "15 min", 30: "30 min", 45: "45 min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    const typeLabel = type === "private" ? "[PRIVE]" : "[ESCORT]";
    let response = `${typeLabel} - Choisissez la duree:\n\n`;
    
    activePrices.forEach((price, i) => {
      const label = durationLabels[price.duration] || `${price.duration} min`;
      const priceValue = type === "private" 
        ? (price.pricePrivate ? price.pricePrivate / 100 : 0)
        : (price.priceEscort ? price.priceEscort / 100 : 0);
      response += `${i + 1}. ${label} - ${priceValue}EUR\n`;
    });

    response += "\n[CMD] Tapez le numero de la duree (ex: 1, 2, 3...)";
    response += "\n[CMD] Tapez *extras* pour les options supplementaires";
    return response;
  }

  private async handleDurationChoice(providerId: string, clientPhone: string, content: string, type: "private" | "escort"): Promise<string> {
    const basePrices = await storage.getBasePrices(providerId);
    const activePrices = basePrices.filter(p => p.active);
    
    const durationLabels: Record<number, string> = {
      15: "15 min", 30: "30 min", 45: "45 min", 
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
      return "Je n'ai pas compris votre choix de duree. Tapez le numero (1, 2, 3...).";
    }

    this.updateConversationState(providerId, clientPhone, { 
      duration: selectedDuration, 
      basePrice: selectedPrice 
    });

    const label = durationLabels[selectedDuration] || `${selectedDuration} min`;
    const typeLabel = type === "private" ? "Prive" : "Escort";
    
    let response = `[OK] ${typeLabel} - ${label}: ${selectedPrice}EUR\n\n`;
    response += "[CMD] Tapez *extras* pour ajouter des options\n";
    response += "[CMD] Tapez *total* pour voir le recap\n";
    response += "[CMD] Tapez *rdv* pour reserver";
    
    return response;
  }

  private generateTotalRecap(providerId: string, clientPhone: string): string {
    const state = this.getConversationState(providerId, clientPhone);
    
    if (!state.type || !state.duration) {
      return "Aucune selection en cours.\n\n[CMD] Tapez *prive* ou *escort* pour commencer";
    }

    const durationLabels: Record<number, string> = {
      15: "15 min", 30: "30 min", 45: "45 min", 
      60: "1h", 90: "1h30", 120: "2h"
    };

    const typeLabel = state.type === "private" ? "Prive" : "Escort";
    const durationLabel = durationLabels[state.duration] || `${state.duration} min`;
    const total = state.basePrice + state.extrasTotal;

    let response = "[RECAPITULATIF]\n\n";
    response += `Type: ${typeLabel}\n`;
    response += `Duree: ${durationLabel}\n`;
    response += `Base: ${state.basePrice}EUR\n`;
    
    if (state.extras.length > 0) {
      response += `Extras: ${state.extras.join(", ")}\n`;
      response += `Supplements: +${state.extrasTotal}EUR\n`;
    }
    
    response += `\n[TOTAL] ${total}EUR\n\n`;
    response += "[CMD] Tapez *rdv* pour reserver ce service";
    
    return response;
  }

  private async generateExtrasList(providerId: string, clientPhone: string): Promise<string> {
    const serviceExtras = await storage.getServiceExtras(providerId);
    const customExtras = await storage.getCustomExtras(providerId);
    const state = this.getConversationState(providerId, clientPhone);
    
    const activeExtras = serviceExtras.filter(e => e.active);
    const activeCustom = customExtras.filter(e => e.active);
    
    if (activeExtras.length === 0 && activeCustom.length === 0) {
      return "Aucun extra n'est disponible actuellement.";
    }

    let response = "[EXTRAS DISPONIBLES]\n\n";
    
    let index = 1;
    activeExtras.forEach(extra => {
      const price = extra.price ? (extra.price / 100) : 0;
      const selected = state.extras.includes(extra.extraType) ? " [x]" : "";
      response += `${index}. ${extra.extraType}: +${price}EUR${selected}\n`;
      index++;
    });
    
    activeCustom.forEach(extra => {
      const price = extra.price ? (extra.price / 100) : 0;
      const selected = state.extras.includes(extra.name) ? " [x]" : "";
      response += `${index}. ${extra.name}: +${price}EUR${selected}\n`;
      index++;
    });

    response += "\n[INFO] Les extras s'ajoutent au tarif de base";
    response += "\n[CMD] Tapez +1, +2, +3... pour ajouter un extra";
    response += "\n[CMD] Tapez *total* pour voir le recapitulatif";
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
      return "Extra non trouve. Tapez +1, +2, +3... pour ajouter un extra.";
    }

    if (state.extras.includes(selectedExtra.name)) {
      return `[INFO] ${selectedExtra.name} deja selectionne.\n\n[CMD] Tapez *total* pour voir le recap.`;
    }

    const newExtras = [...state.extras, selectedExtra.name];
    const newExtrasTotal = state.extrasTotal + (selectedExtra.price / 100);
    
    this.updateConversationState(providerId, clientPhone, {
      extras: newExtras,
      extrasTotal: newExtrasTotal,
    });

    const total = state.basePrice + newExtrasTotal;
    
    let response = `[OK] ${selectedExtra.name} ajoute (+${selectedExtra.price / 100}EUR)\n\n`;
    response += `Extras: ${newExtras.join(", ")}\n`;
    response += `Total actuel: ${total}EUR\n\n`;
    response += "[CMD] Tapez *extras* pour en ajouter d'autres\n";
    response += "[CMD] Tapez *total* pour le recap final\n";
    response += "[CMD] Tapez *rdv* pour reserver";
    
    return response;
  }

  private generateServiceInfo(services: any[]): string {
    if (services.length === 0) {
      return "Désolé, aucun service n'est disponible pour le moment.";
    }

    let response = "[NOS SERVICES]\n\n";
    services
      .filter(s => s.active)
      .forEach(service => {
        response += `> *${service.name}*`;
        if (service.description) {
          response += `\n  ${service.description}`;
        }
        response += `\n  Duree: ${service.duration} min\n\n`;
      });

    response += "[CMD] Tapez 'prix' pour voir nos tarifs";
    return response;
  }

  private async generateAvailableSlots(providerId: string, clientPhone: string, services: any[], businessHours: any[]): Promise<string> {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const state = this.getConversationState(providerId, clientPhone);

    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours);

    if (services.length === 0) {
      return "Désolé, aucun service n'est disponible pour le moment.";
    }

    let response = "[CRENEAUX DISPONIBLES]\n\n";

    if (todaySlots.length > 0) {
      response += "*Aujourd'hui:*\n";
      todaySlots.forEach((slot, i) => {
        response += `${i + 1}. ${slot}\n`;
      });
    } else {
      response += "*Aujourd'hui:* Complet\n";
    }

    response += "\n";

    if (tomorrowSlots.length > 0) {
      response += `*${format(tomorrow, "EEEE d MMMM", { locale: fr })}:*\n`;
      tomorrowSlots.forEach((slot, i) => {
        response += `${todaySlots.length + i + 1}. ${slot}\n`;
      });
    } else {
      response += `*${format(tomorrow, "EEEE d MMMM", { locale: fr })}:* Complet\n`;
    }

    response += "\n[CMD] Pour reserver, indiquez le numero du creneau souhaite (ex: '1' pour le premier creneau)";

    if (services.length > 1) {
      response += "\n\nQuel service souhaitez-vous ?\n";
      services.filter(s => s.active).forEach((s, i) => {
        response += `${String.fromCharCode(65 + i)}. ${s.name}\n`;
      });
    }

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

      const formattedDate = format(appointmentDate, "EEEE d MMMM 'à' HH:mm", { locale: fr });
      
      return `[CONFIRME] *Rendez-vous confirme!*\n\nDate: ${formattedDate}\nService: ${selectedService.name}\nDuree: ${selectedService.duration} minutes\n\nVous recevrez un rappel 1h avant votre rendez-vous. A bientot!`;
    } catch (error) {
      console.error("Error creating appointment:", error);
      return "Désolé, une erreur est survenue lors de la réservation. Veuillez réessayer.";
    }
  }

  private generateDefaultResponse(businessName: string): string {
    return `Merci pour votre message!\n\nJe suis l'assistant de ${businessName}. Voici ce que je peux faire pour vous:\n\n[SERVICES] "services" - Voir nos prestations\n[PRIX] "prix" - Connaitre nos tarifs\n[RDV] "rdv" - Prendre rendez-vous\n\nComment puis-je vous aider?`;
  }

  async sendMessage(providerId: string, to: string, message: string) {
    const session = this.sessions.get(providerId);
    if (!session?.connected) {
      console.error(`Cannot send message: WhatsApp not connected for provider ${providerId}`);
      return;
    }

    try {
      const chatId = to.includes("@c.us") ? to : `${to}@c.us`;
      await session.client.sendMessage(chatId, message);
      // GDPR: No message content logging - messages are processed ephemerally
    } catch (error) {
      console.error(`Error sending message:`, error);
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
        console.error(`Error disconnecting WhatsApp for provider ${providerId}:`, error);
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
}

export const whatsappManager = new WhatsAppManager();
