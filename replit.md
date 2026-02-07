# ChatSlot - WhatsApp Booking Assistant

## Overview

ChatSlot is a SaaS application that enables service providers to automate appointment bookings through WhatsApp. The platform provides an intelligent WhatsApp bot that handles client inquiries, automatic appointment scheduling, reminder notifications, and a shared safety system for problematic clients.

The application follows a monorepo structure with a React frontend, Express backend, PostgreSQL database, and WhatsApp Web integration for messaging capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.
Design aesthetic: Cypherpunk/Underground (pure black #000000 background, neon Matrix green #39FF14 accents)

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack Query (React Query) for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom neon green theme
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Authentication**: Custom Email/Password with JWT tokens
- **Security**: Helmet middleware for HTTP headers protection
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **WhatsApp Integration**: whatsapp-web.js library with Puppeteer
- **Scheduled Tasks**: node-cron for appointment reminders

### Data Storage
- **Database**: PostgreSQL
- **Schema Management**: Drizzle Kit for migrations
- **Key Tables**:
  - `users` / `sessions`: User authentication data
  - `provider_profiles`: Extended business info for service providers
  - `services`: Service offerings with pricing and duration
  - `business_hours`: Weekly schedule configuration
  - `appointments`: Client bookings with status tracking
  - `blocked_slots`: Manual time blocking
  - `blacklist`: Shared problematic client registry
  - `safety_blacklist`: Dangerous clients safety system

### API Structure
- RESTful API under `/api` prefix
- JWT-protected routes using `isAuthenticated` middleware
- Provider-scoped data access based on authenticated user

### Key Features
1. **WhatsApp Bot**: Automated responses to client messages, appointment booking flow
2. **Appointment Management**: Calendar view, booking, cancellation, status updates
3. **Reminder System**: Automated 1-hour pre-appointment notifications via WhatsApp
4. **T-15 Exact Address System**: Automatic exact address delivery 15min before appointment
5. **Address Split Security**: `addressApprox` (street/neighborhood) given at booking, `addressExact` (number + entry) sent only at T-15 or when client says "arrived"
6. **Shared Safety System**: Cross-provider protection against problematic/dangerous clients
7. **Business Hours**: Configurable weekly availability schedule
8. **Availability Modes**: ACTIVE (full bot), AWAY (single auto-reply), GHOST (silent)
9. **Anti-ban Censorship**: Automatic text obfuscation for sensitive content
10. **Internationalization (i18n)**: Complete multi-language support for 11 languages

### Internationalization System
- **Framework**: i18next with react-i18next
- **Supported Languages**: FR (French - default), NL (Dutch), EN (English), ES (Spanish), RO (Romanian), PT (Portuguese), DE (German), SQ (Albanian), HU (Hungarian), IT (Italian), ZH (Chinese)
- **Auto-Detection**: Browser language detection via localStorage → navigator → htmlTag
- **Storage**: Language preference stored in localStorage under key "chatslot-language"
- **Translation Files**: Located in `client/src/locales/*.json` (fr.json, nl.json, en.json, etc.)
- **UI Selector**: Terminal-style language selector [FR] [NL] [EN] etc. in sidebar footer
- **Date Localization**: date-fns locales integrated for proper date formatting in each language

## External Dependencies

### Third-Party Services
- **PostgreSQL**: Database
- **WhatsApp Web**: Client-side WhatsApp automation via whatsapp-web.js

### Key NPM Packages
- `whatsapp-web.js`: WhatsApp Web client automation
- `qrcode`: QR code generation for WhatsApp pairing
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `bcryptjs` / `jsonwebtoken`: Authentication
- `helmet`: Security middleware
- `node-cron`: Scheduled task execution
- `date-fns`: Date manipulation utilities
- `i18next` / `react-i18next`: Internationalization framework
- `i18next-browser-languagedetector`: Automatic language detection

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET` or `SESSION_SECRET`: JWT token signing key
