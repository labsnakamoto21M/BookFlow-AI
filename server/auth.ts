import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { users, registerSchema, loginSchema, resetPasswordSchema } from "@shared/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;
const JWT_EXPIRES_IN = "7d";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET or SESSION_SECRET environment variable is required");
}

const WORDLIST = [
  "alpha", "bravo", "cyber", "delta", "echo", "foxtrot", "ghost", "hacker",
  "intel", "jungle", "krypto", "laser", "matrix", "neon", "omega", "phantom",
  "quantum", "radar", "shadow", "turbo", "ultra", "vector", "warp", "xenon",
  "zodiac", "access", "binary", "cipher", "daemon", "enigma", "firewall", "grid",
  "hexagon", "icarus", "joker", "kernel", "logic", "module", "nexus", "orbit",
  "pixel", "quasar", "router", "server", "token", "uplink", "vertex", "wire",
  "zenith", "archive", "beacon", "cortex", "digital", "entropy", "flux", "gamma",
  "horizon", "index", "jolt", "kinetic", "lambda", "macro", "neural", "oxide",
  "pulse", "qubit", "relay", "signal", "trace", "unity", "voltage", "wave",
  "xray", "yield", "zero", "apex", "blast", "clone", "drone", "edge", "forge",
  "glitch", "hydra", "inject", "jack", "link", "morph", "node", "onyx", "prime",
  "quest", "rogue", "spark", "titan", "vortex", "wraith", "axis", "bolt", "core"
];

export function generateRecoveryPhrase(): string {
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const randomIndex = Math.floor(Math.random() * WORDLIST.length);
    words.push(WORDLIST[randomIndex]);
  }
  return words.join(" ");
}

export interface JWTPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        firstName?: string | null;
        lastName?: string | null;
      };
    }
  }
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JWTPayload;
  } catch {
    return null;
  }
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ message: "Non authentifié" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: "Token invalide ou expiré" });
  }

  req.user = {
    id: payload.userId,
    email: payload.email,
  };

  next();
}

export function registerAuthRoutes(app: any) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const validation = registerSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: validation.error.errors[0].message });
      }

      const { email, password, firstName, lastName } = validation.data;

      const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existingUser.length > 0) {
        return res.status(409).json({ message: "Cet email est déjà utilisé" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const recoveryPhrase = generateRecoveryPhrase();
      const recoveryPhraseHash = await bcrypt.hash(recoveryPhrase.toLowerCase(), 12);
      
      const [newUser] = await db.insert(users).values({
        email,
        passwordHash,
        recoveryPhraseHash,
        firstName: firstName || null,
        lastName: lastName || null,
      }).returning();

      const token = generateToken({ userId: newUser.id, email: newUser.email! });

      res.status(201).json({
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
        },
        token,
        recoveryPhrase,
      });
    } catch (error) {
      res.status(500).json({ message: "Erreur lors de l'inscription" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: validation.error.errors[0].message });
      }

      const { email, password } = validation.data;

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Email ou mot de passe incorrect" });
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Email ou mot de passe incorrect" });
      }

      const token = generateToken({ userId: user.id, email: user.email! });

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        token,
      });
    } catch (error) {
      res.status(500).json({ message: "Erreur lors de la connexion" });
    }
  });

  app.get("/api/auth/user", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Non authentifié" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      res.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      res.status(500).json({ message: "Erreur serveur" });
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.json({ success: true });
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const validation = resetPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: validation.error.errors[0].message });
      }

      const { email, recoveryPhrase, newPassword } = validation.data;

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user || !user.recoveryPhraseHash) {
        return res.status(401).json({ message: "Email ou phrase de récupération incorrect" });
      }

      const isValidPhrase = await bcrypt.compare(recoveryPhrase.toLowerCase().trim(), user.recoveryPhraseHash);
      if (!isValidPhrase) {
        return res.status(401).json({ message: "Email ou phrase de récupération incorrect" });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash: newPasswordHash }).where(eq(users.id, user.id));

      res.json({ success: true, message: "Mot de passe réinitialisé avec succès" });
    } catch (error) {
      res.status(500).json({ message: "Erreur lors de la réinitialisation" });
    }
  });
}
