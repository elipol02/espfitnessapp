# ESP Fitness ([https://espfitnessapp.com])

An AI-powered fitness planning and workout tracking Progressive Web App (PWA) built with Next.js. Chat with an AI coach to generate personalized workout plans, then track your workouts in real time with automatic progression suggestions.

---

## Features

- **AI Workout Coach** — Conversational plan creation and editing powered by Claude Haiku via OpenRouter. The AI asks structured questions about your schedule, equipment, experience level, and injuries before generating a complete multi-week program.
- **Live Workout Tracking** — Exercise-by-exercise logging with type-specific interfaces for strength, distance, timed, AMRAP, EMOM, Tabata, and round-block workouts.
- **Auto-Progression** — Before each workout the app computes suggested weights/reps based on your last session using linear or double-progression rules.
- **Rest Timer** — A floating badge with a configurable countdown timer that persists as you navigate between exercises.
- **Calendar View** — Month and week views showing scheduled and completed workouts at a glance.
- **AI Memory** — The coach remembers facts about you (injuries, goals, preferences) and injects them into future conversations.
- **Motivational Messages** — A tiered daily message system on the home dashboard that reacts to your plan completion rate.
- **PWA** — Installable on mobile with offline support via a service worker.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4, Geist font |
| Database | PostgreSQL 16 |
| ORM | Prisma 7 (`@prisma/adapter-pg`) |
| Auth | NextAuth v5 (credentials, JWT) |
| AI | OpenRouter API — `anthropic/claude-haiku-4.5` |
| State | Zustand v5 |
| Validation | Zod v4 |
| Icons | lucide-react |
| PWA | `@ducanh2912/next-pwa` |

---

## Project Structure

```
espfitnessapp/
├── app/
│   ├── (auth)/                   # Login, register, onboarding
│   ├── (main)/                   # Auth-guarded app pages
│   │   ├── home/                 # Dashboard
│   │   ├── calendar/             # Workout calendar
│   │   ├── workout/
│   │   │   ├── today/            # Redirect to today's live workout
│   │   │   ├── preview/          # Read-only future workout preview
│   │   │   └── live/             # Active workout tracker
│   │   ├── plans/                # All workout plans
│   │   ├── plan/[planId]/        # Plan detail view
│   │   └── chat/                 # AI coach chat
│   ├── api/                      # API route handlers
│   │   ├── auth/                 # NextAuth + registration
│   │   ├── chat/                 # SSE stream, sessions, partial saves
│   │   ├── plan/                 # Plan CRUD, AI apply
│   │   ├── workout/              # Sessions, set logging, progression
│   │   └── user/                 # Profile updates
│   ├── components/               # Shared UI components
│   ├── lib/                      # Core logic
│   │   ├── auth.ts               # NextAuth config + session guard
│   │   ├── db.ts                 # Prisma client singleton
│   │   ├── openrouter.ts         # AI client, tools, system prompt
│   │   ├── progression.ts        # Auto-progression engine
│   │   └── motivationalMessages.ts
│   └── types/index.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── public/                       # PWA manifest, service worker, icons
└── docker-compose.yml
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for local Postgres) or an external PostgreSQL connection string
- An [OpenRouter](https://openrouter.ai) API key

### 1. Install dependencies

```bash
cd espfitnessapp
npm install
```

### 2. Configure environment variables

Create a `.env` file in the `espfitnessapp/` directory:

```env
# PostgreSQL connection (pooled — used at runtime)
DATABASE_URL="postgresql://espfitness:espfitness_dev@localhost:5432/espfitness"

# Direct connection (non-pooled — used by Prisma CLI for migrations)
DIRECT_URL="postgresql://espfitness:espfitness_dev@localhost:5432/espfitness"

# NextAuth
NEXTAUTH_SECRET="your-random-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# OpenRouter (AI)
OPENROUTER_API_KEY="sk-or-..."
```

> Generate `NEXTAUTH_SECRET` with: `openssl rand -base64 32`

### 3. Start the database

```bash
docker-compose up -d
```

This starts a local PostgreSQL 16 instance on port `5432` with the database `espfitness`.

### 4. Run database migrations

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run build:ci` | Full CI build (`npm ci` + `prisma generate` + `build`) |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

---

## Database Schema

| Model | Description |
|---|---|
| `User` | Email, hashed password, bodyweight, onboarding status |
| `WorkoutPlan` | Named plan with start/end dates and `active`/`archived` status |
| `WorkoutType` | A named workout template (e.g. "Push Day") with color/category |
| `Exercise` | An exercise inside a WorkoutType with type config and progression rules |
| `PlanDayAssignment` | Maps a WorkoutType to a day-of-week within a plan |
| `WorkoutSession` | A completed or in-progress workout instance on a specific date |
| `ExerciseEntry` | Logged sets/reps/weight for one exercise in a session |
| `ChatSession` | A conversation thread |
| `ChatMessage` | Individual messages; includes metadata for AI plan previews |
| `ChatMemory` | Persistent facts the AI remembers about a user |

---

## AI Coach

The chat interface connects to **Claude Haiku** via OpenRouter using server-sent events (SSE) for streaming responses. The AI has access to five tools:

| Tool | Description |
|---|---|
| `create_workout_plan` | Generate a complete multi-week plan from structured parameters |
| `edit_workout_plan` | Propose targeted modifications to an existing plan |
| `ask_user` | Ask one or more follow-up questions before acting |
| `get_workout_history` | Look up a user's recent completed workouts |
| `write_memory` | Persist a fact about the user for future sessions |

Plan creations and edits are shown as a preview card in the chat before being applied to the database, giving you a chance to review or reject them.

---

## Workout Types

The live tracker supports the following exercise types, each with a dedicated logging UI:

| Type | Logged Fields |
|---|---|
| `strength` | Sets × reps × weight (editable) |
| `distance` | Sets × distance |
| `time` | Countdown timer + log |
| `amrap` | Running clock, rep counter |
| `emom` | Interval timer with round counter |
| `tabata` | Work/rest interval timer |
| `round_block` | Configurable rounds timer |
| `simple` | Mark complete |

---

## Progression System

Before each workout, `lib/progression.ts` queries your last completed session for each exercise and computes a suggestion using one of two rules configured per exercise:

- **`linear`** — Add a fixed amount of weight each session.
- **`double_progression`** — Build reps toward a target range, then increase weight and reset reps.

---

## Deployment

The app can be deployed to any platform that supports Next.js (Vercel, Railway, Render, self-hosted, etc.). For production you will need:

1. A managed PostgreSQL instance (e.g. Supabase, Neon, Railway Postgres).
2. Set `DATABASE_URL` to the pooled connection string and `DIRECT_URL` to the direct (non-pooled) connection string.
3. Run `npx prisma migrate deploy` as part of your deploy pipeline (or use `npm run build:ci`).
4. Set all environment variables listed above in your hosting platform.

### Vercel (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

Set the root directory to `espfitnessapp/` and add the required environment variables in the Vercel project settings.
