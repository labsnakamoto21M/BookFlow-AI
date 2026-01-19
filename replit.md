# ChatSlot - Gestion de Réservations Intelligente

## Overview

ChatSlot is a SaaS application that enables service providers (hairdressers, beauticians, etc.) to manage and automate their appointment bookings. The platform provides an intelligent assistant connected to WhatsApp that handles client inquiries, automatic appointment scheduling, reminder notifications, and a shared blacklist system for problematic clients.

The application follows a monorepo structure with a React frontend, Express backend, PostgreSQL database, and WhatsApp Web integration for messaging capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack Query (React Query) for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom WhatsApp-inspired green theme
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with custom plugins for Replit integration

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Authentication**: Replit Auth (OpenID Connect) with Passport.js
- **Session Management**: express-session with PostgreSQL store (connect-pg-simple)
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **WhatsApp Integration**: whatsapp-web.js library with Puppeteer
- **Scheduled Tasks**: node-cron for appointment reminders

### Data Storage
- **Database**: PostgreSQL
- **Schema Management**: Drizzle Kit for migrations
- **Key Tables**:
  - `users` / `sessions`: Replit Auth user data and sessions
  - `provider_profiles`: Extended business info for service providers
  - `services`: Service offerings with pricing and duration
  - `business_hours`: Weekly schedule configuration
  - `appointments`: Client bookings with status tracking
  - `blocked_slots`: Manual time blocking
  - `blacklist`: Shared problematic client registry
  - `message_log`: WhatsApp conversation history

### API Structure
- RESTful API under `/api` prefix
- Protected routes using `isAuthenticated` middleware
- Provider-scoped data access based on authenticated user

### Key Features
1. **WhatsApp Bot**: Automated responses to client messages, appointment booking flow
2. **Appointment Management**: Calendar view, booking, cancellation, status updates
3. **Reminder System**: Automated 1-hour pre-appointment notifications via WhatsApp
4. **Shared Blacklist**: Cross-provider protection against problematic clients
5. **Business Hours**: Configurable weekly availability schedule
6. **Subscription Management**: Trial/active/expired subscription status tracking

## External Dependencies

### Third-Party Services
- **Replit Auth**: OpenID Connect authentication provider (via Replit platform)
- **PostgreSQL**: Database provisioned through Replit
- **WhatsApp Web**: Client-side WhatsApp automation via whatsapp-web.js

### Key NPM Packages
- `whatsapp-web.js`: WhatsApp Web client automation
- `qrcode`: QR code generation for WhatsApp pairing
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `passport` / `openid-client`: Authentication handling
- `node-cron`: Scheduled task execution
- `date-fns`: Date manipulation utilities

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Session encryption key
- `ISSUER_URL`: Replit Auth OIDC issuer (defaults to https://replit.com/oidc)
- `REPL_ID`: Replit environment identifier