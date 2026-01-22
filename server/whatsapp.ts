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

class WhatsAppManager {
  private sessions: Map<string, WhatsAppSession> = new Map();

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

    // Log the incoming message (only for unknown contacts that passed filters)
    await storage.logMessage({
      providerId,
      clientPhone,
      direction: "incoming",
      content: msg.body,
    });

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

    // Check client reliability score and log alert for provider (visible in dashboard only)
    const reliability = await storage.getClientReliability(clientPhone);
    if (reliability && reliability.noShowTotal && reliability.noShowTotal > 0) {
      // Log the alert for the provider to see in their dashboard (NOT sent to client)
      console.log(`ALERT for provider ${providerId}: Client ${clientPhone} has ${reliability.noShowTotal} no-show(s)`);
      
      // Log a special message in the message log for provider visibility
      await storage.logMessage({
        providerId,
        clientPhone,
        direction: "system",
        content: `[ALERTE] Ce contact a ${reliability.noShowTotal} signalement(s) de RDV non honore(s).`,
      });
    }

    // Check if client is in shared blacklist
    const blacklisted = await storage.isBlacklisted(clientPhone);
    if (blacklisted) {
      console.log(`Blacklisted client ${clientPhone} tried to contact provider ${providerId}`);
    }

    let response = "";

    // Handle different types of messages
    if (this.isGreeting(content)) {
      response = this.generateGreeting(profile.businessName);
    } else if (this.isPriceQuery(content)) {
      response = this.generatePriceList(services);
    } else if (this.isServiceQuery(content)) {
      response = this.generateServiceInfo(services);
    } else if (this.isBookingRequest(content)) {
      response = await this.generateAvailableSlots(providerId, services, businessHours);
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

  private generateGreeting(businessName: string): string {
    return `Bonjour ! Bienvenue chez ${businessName}. 👋\n\nJe suis votre assistant de réservation. Comment puis-je vous aider ?\n\n📋 Tapez "services" pour voir nos prestations\n💰 Tapez "prix" pour connaître nos tarifs\n📅 Tapez "rdv" pour prendre rendez-vous`;
  }

  private generatePriceList(services: any[]): string {
    if (services.length === 0) {
      return "Désolé, aucun service n'est disponible pour le moment.";
    }

    let response = "💰 *Nos tarifs :*\n\n";
    services
      .filter(s => s.active)
      .forEach(service => {
        const price = (service.price / 100).toFixed(2).replace(".", ",");
        response += `• ${service.name}: ${price}€ (${service.duration} min)\n`;
      });

    response += "\n📅 Tapez 'rdv' pour prendre rendez-vous !";
    return response;
  }

  private generateServiceInfo(services: any[]): string {
    if (services.length === 0) {
      return "Désolé, aucun service n'est disponible pour le moment.";
    }

    let response = "📋 *Nos services :*\n\n";
    services
      .filter(s => s.active)
      .forEach(service => {
        response += `• *${service.name}*`;
        if (service.description) {
          response += `\n  ${service.description}`;
        }
        response += `\n  Durée: ${service.duration} min\n\n`;
      });

    response += "💰 Tapez 'prix' pour voir nos tarifs";
    return response;
  }

  private async generateAvailableSlots(providerId: string, services: any[], businessHours: any[]): Promise<string> {
    const today = new Date();
    const tomorrow = addDays(today, 1);

    const todaySlots = await this.getAvailableSlots(providerId, today, businessHours);
    const tomorrowSlots = await this.getAvailableSlots(providerId, tomorrow, businessHours);

    if (services.length === 0) {
      return "Désolé, aucun service n'est disponible pour le moment.";
    }

    let response = "📅 *Créneaux disponibles :*\n\n";

    if (todaySlots.length > 0) {
      response += "*Aujourd'hui :*\n";
      todaySlots.forEach((slot, i) => {
        response += `${i + 1}. ${slot}\n`;
      });
    } else {
      response += "*Aujourd'hui :* Complet\n";
    }

    response += "\n";

    if (tomorrowSlots.length > 0) {
      response += `*${format(tomorrow, "EEEE d MMMM", { locale: fr })} :*\n`;
      tomorrowSlots.forEach((slot, i) => {
        response += `${todaySlots.length + i + 1}. ${slot}\n`;
      });
    } else {
      response += `*${format(tomorrow, "EEEE d MMMM", { locale: fr })} :* Complet\n`;
    }

    response += "\n📝 Pour réserver, indiquez le numéro du créneau souhaité (ex: '1' pour le premier créneau)";

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
      
      return `✅ *Rendez-vous confirmé !*\n\n📅 ${formattedDate}\n💇 ${selectedService.name}\n⏱️ ${selectedService.duration} minutes\n\nVous recevrez un rappel 1h avant votre rendez-vous. À bientôt ! 👋`;
    } catch (error) {
      console.error("Error creating appointment:", error);
      return "Désolé, une erreur est survenue lors de la réservation. Veuillez réessayer.";
    }
  }

  private generateDefaultResponse(businessName: string): string {
    return `Merci pour votre message ! 🙏\n\nJe suis l'assistant de ${businessName}. Voici ce que je peux faire pour vous :\n\n📋 "services" - Voir nos prestations\n💰 "prix" - Connaître nos tarifs\n📅 "rdv" - Prendre rendez-vous\n\nComment puis-je vous aider ?`;
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
      
      await storage.logMessage({
        providerId,
        clientPhone: to.replace("@c.us", ""),
        direction: "outgoing",
        content: message,
      });
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
