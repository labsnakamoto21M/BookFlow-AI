import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { createServer } from "http";

import { registerRoutes } from "./routes";
import { serveStatic } from "./static";

// --- Crash visibility (utile sur Railway) ---
process.on("unhandledRejection", (err) => {
  console.error("[FATAL] unhandledRejection", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException", err);
  process.exit(1);
});

// --- Feature flags / config ---
const DISABLE_STRIPE = process.env.DISABLE_STRIPE === "1";
const DISABLE_WHATSAPP = process.env.DISABLE_WHATSAPP === "1";

// Stripe init lourd (migrations/sync/webhook auto-config) -> OFF par défaut
const ENABLE_STRIPE_INIT = process.env.ENABLE_STRIPE_INIT === "1";

// Sur Railway, définis PUBLIC_BASE_URL = https://xxxxx.up.railway.app
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

console.log("[BOOT] starting", {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  databaseUrlSet: Boolean(process.env.DATABASE_URL),
  disableStripe: DISABLE_STRIPE,
  enableStripeInit: ENABLE_STRIPE_INIT,
  disableWhatsapp: DISABLE_WHATSAPP,
  publicBaseUrlSet: Boolean(PUBLIC_BASE_URL),
});

const app = express();
app.set("etag", false);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.disable("x-powered-by");

const httpServer = createServer(app);

// Pour compat raw-body logic (si tu l’utilises ailleurs)
declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/**
 * Stripe webhook: DOIT recevoir le body brut (raw)
 * -> on le place avant express.json()
 */
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (DISABLE_STRIPE) {
      return res.status(503).json({ error: "Stripe disabled" });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        console.error("[Stripe Webhook] req.body is not a Buffer");
        return res.status(500).json({ error: "Webhook processing error" });
      }

      // Lazy import: évite crash au boot
      const { WebhookHandlers } = await import("./webhookHandlers");
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      return res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("[Stripe Webhook] Error:", error?.stack || error?.message || error);
      return res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// JSON body parser (après le webhook)
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Logger API (comme ton ancien fichier)
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // --- Stripe init (non bloquant, contrôlé) ---
  if (DISABLE_STRIPE) {
    console.log("[Stripe] Disabled (DISABLE_STRIPE=1)");
  } else if (!ENABLE_STRIPE_INIT) {
    console.log("[Stripe] Init skipped (ENABLE_STRIPE_INIT!=1)");
  } else {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log("[Stripe] Init skipped (DATABASE_URL not set)");
    } else {
      try {
        console.log("[Stripe] Initializing schema...");

        // Lazy import pour éviter crash au boot
        const { runMigrations } = await import("stripe-replit-sync");
        await runMigrations({ databaseUrl });

        console.log("[Stripe] Schema ready");

        const { getStripeSync } = await import("./stripeClient");
        const stripeSync = await getStripeSync();

        // Sur Railway: utiliser PUBLIC_BASE_URL (pas REPLIT_DOMAINS)
        if (PUBLIC_BASE_URL) {
          try {
            const url = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/api/stripe/webhook`;
            const result = await stripeSync.findOrCreateManagedWebhook(url);

            if (result?.webhook?.url) {
              console.log(`[Stripe] Webhook configured: ${result.webhook.url}`);
            } else {
              console.log("[Stripe] Webhook setup skipped (no URL returned)");
            }
          } catch (webhookError: any) {
            console.log("[Stripe] Webhook setup skipped:", webhookError?.message || webhookError);
          }
        } else {
          console.log("[Stripe] Webhook auto-config skipped (PUBLIC_BASE_URL not set)");
        }

        // Backfill / sync (peut être long): garde-le, mais non bloquant
        stripeSync
          .syncBackfill()
          .then(() => console.log("[Stripe] Data synced"))
          .catch((err: any) => console.error("[Stripe] Sync error:", err?.stack || err));
      } catch (error: any) {
        console.error("[Stripe] Initialization failed:", error?.stack || error?.message || error);
      }
    }
  }

  // --- Routes ---
  await registerRoutes(httpServer, app);

  // --- Error handler ---
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);

    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  // --- Static / Vite ---
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // --- Listen ---
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // WhatsApp auto-reconnect: ne doit jamais bloquer le serveur
      if (DISABLE_WHATSAPP) {
        console.log("[WhatsApp] Disabled (DISABLE_WHATSAPP=1)");
      } else {
        setTimeout(async () => {
          try {
            const { whatsappManager } = await import("./whatsapp");
            await whatsappManager.autoReconnectAll();
          } catch (err: any) {
            console.error("[WA] Startup auto-reconnect failed:", err?.stack || err);
          }
        }, 3000);
      }
    },
  );
})();
