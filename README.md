# 🏆 MatchSocket

A production-grade, highly resilient real-time sports dashboard API that broadcasts live match scores and ball-by-ball commentary to connected clients over WebSockets. The system features a selective subscribe/unsubscribe protocol, a type-safe database layer, strict validation schemas, bot protection, and APM monitoring.

---

## 🏗️ System Architecture

```mermaid
graph TD
    Client[Client] <-->|WebSockets & REST API| Gateway[Arcjet Security Gateway]
    Gateway <-->|Filtered Traffic| Express[Express Server]
    Express <-->|Routes & Middleware| WS[WS Server]
    Express <-->|Drizzle ORM| DB[(PostgreSQL / Neon)]
    WS <-->|Heartbeats & Broadcasts| Client
    Site24x7[Site24x7 APM] -.->|Uptime & Perf Monitoring| Express
```

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend** | Node.js + Express 5 | REST API and HTTP server orchestration |
| **Real-time** | `ws` (WebSockets) | High-performance, low-overhead bi-directional communication |
| **Database** | PostgreSQL (Neon) | Robust relational storage for matches and commentary |
| **ORM** | Drizzle ORM + Drizzle Kit | Type-safe database queries, migrations, and studio |
| **Validation** | Zod | Runtime validation for API payloads and WebSocket messages |
| **Security** | Arcjet | Bot detection, shield protection, and sliding-window rate limiting |
| **Monitoring** | Site24x7 APM (`apminsight`) | Uptime checks and end-to-end performance tracing |

---

## ⚡ Key Features & Engineering Highlights

### 1. Selective WebSocket Subscription Protocol
Clients connect to a single WebSocket gateway at `/ws` and use a custom JSON protocol to subscribe and unsubscribe to specific match rooms. The server maintains room lists dynamically via a `Map<matchId, Set<socket>>` and broadcasts updates *only* to clients subscribed to that specific match.

### 2. Production-Grade WebSocket Resilience
*   **`noServer` Mode with Manual Upgrade Handling**: The WS server runs in `noServer` mode. The HTTP server intercepts `upgrade` requests, validates the pathname (`/ws`), runs Arcjet security checks on the handshake, and only then completes the upgrade.
*   **Heartbeat / Ping-Pong**: Automatically detects and terminates dead connections (zombie sockets) every 30 seconds.
*   **Payload Size Limit**: `maxPayload` is set to 1 MB to prevent oversized messages from crashing the server.
*   **Subscription Cleanup**: When a socket disconnects, all its subscriptions are automatically cleaned up to prevent memory leaks.

### 3. Comprehensive Security with Arcjet
Protected against modern web threats with **two separate Arcjet instances**:
*   **HTTP Arcjet** — Applied as Express middleware to all REST endpoints:
    *   **Shield**: Protects against common web exploits.
    *   **Bot Detection**: Blocks automated scrapers while allowing search engines, previews, and cURL.
    *   **Sliding-Window Rate Limiting**: 50 requests per 10-second window.
*   **WebSocket Arcjet** — Applied during the WebSocket upgrade handshake:
    *   **Shield + Bot Detection**: Same protections as HTTP.
    *   **Stricter Rate Limiting**: 5 requests per 2-second window on connection attempts.

### 4. Automatic Match Status Calculation
Match status (`scheduled`, `live`, `finished`) is automatically determined at creation time based on `startTime` and `endTime` relative to the current time, via the `getMatchStatus()` utility.

### 5. Real-Time Broadcast on Write
*   **Match Created**: When a new match is created via the REST API, a `match_created` event is broadcast to **all** connected WebSocket clients.
*   **Commentary Added**: When commentary is posted, a `commentary` event is broadcast only to clients **subscribed** to that specific match.

---

## 🗄️ Database Schema & Models

The relational schema is modeled using **Drizzle ORM** with a PostgreSQL `pgEnum` for match status:

```javascript
// src/db/schema.js
import { pgTable, serial, text, integer, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const matchStatus = pgEnum('match_status', ['scheduled', 'live', 'finished']);

export const matches = pgTable('matches', {
  id: serial('id').primaryKey(),
  sport: text('sport').notNull(),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  status: matchStatus('status').notNull().default('scheduled'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  homeScore: integer('home_score').default(0).notNull(),
  awayScore: integer('away_score').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const commentary = pgTable('commentary', {
  id: serial('id').primaryKey(),
  matchId: integer('match_id')
    .references(() => matches.id, { onDelete: 'cascade' })
    .notNull(),
  minute: integer('minute'),
  sequence: integer('sequence').notNull(),
  period: text('period').notNull(),
  eventType: text('event_type').notNull(),
  actor: text('actor'),
  team: text('team'),
  message: text('message').notNull(),
  metadata: jsonb('metadata'),
  tags: text('tags').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## 🚦 REST API Specifications

### Matches

#### `GET /matches`
Retrieve all matches, ordered by most recently created. Supports an optional `limit` query parameter (max 100, default 50).
*   **Response (200 OK)**:
    ```json
    {
      "data": [
        {
          "id": 1,
          "sport": "football",
          "homeTeam": "Arsenal FC",
          "awayTeam": "Liverpool FC",
          "status": "live",
          "startTime": "2025-02-01T12:00:00.000Z",
          "endTime": "2025-02-01T13:45:00.000Z",
          "homeScore": 2,
          "awayScore": 1,
          "createdAt": "2025-02-01T11:00:00.000Z"
        }
      ]
    }
    ```

#### `POST /matches`
Create a new match. Payloads are validated via Zod. Match status is automatically calculated from `startTime` / `endTime`. On success, a `match_created` WebSocket broadcast is sent to all connected clients.
*   **Request Body**:
    ```json
    {
      "sport": "football",
      "homeTeam": "Arsenal FC",
      "awayTeam": "Liverpool FC",
      "startTime": "2026-07-15T01:43:00+00:00",
      "endTime": "2026-07-15T03:43:00+00:00",
      "homeScore": 0,
      "awayScore": 0
    }
    ```
*   **Validation Rules**:
    *   `sport`, `homeTeam`, `awayTeam` — non-empty strings
    *   `startTime`, `endTime` — valid ISO 8601 date strings
    *   `endTime` must be chronologically after `startTime`
    *   `homeScore`, `awayScore` — optional non-negative integers

### Commentary

#### `GET /matches/:id/commentary`
Retrieve commentary for a specific match, ordered by most recent. Supports an optional `limit` query parameter (max 100).
*   **Response (200 OK)**:
    ```json
    {
      "data": [
        {
          "id": 1,
          "matchId": 3,
          "minute": 42,
          "sequence": 120,
          "period": "2nd half",
          "eventType": "goal",
          "actor": "Alex Morgan",
          "team": "FC Neon",
          "message": "GOAL! Powerful finish from the edge of the box.",
          "metadata": { "assist": "Sam Kerr" },
          "tags": ["goal", "shot"],
          "createdAt": "2026-07-11T10:48:35.000Z"
        }
      ]
    }
    ```

#### `POST /matches/:id/commentary`
Post a commentary update for a match. On success, a `commentary` WebSocket broadcast is sent to all clients subscribed to that match.
*   **Request Body**:
    ```json
    {
      "minute": 42,
      "sequence": 120,
      "period": "2nd half",
      "eventType": "goal",
      "actor": "Alex Morgan",
      "team": "FC Neon",
      "message": "GOAL! Powerful finish from the edge of the box.",
      "metadata": { "assist": "Sam Kerr" },
      "tags": ["goal", "shot"]
    }
    ```
*   **Validation Rules**:
    *   `minute` — required non-negative integer
    *   `message` — required non-empty string
    *   `sequence`, `period`, `eventType`, `actor`, `team` — optional strings/integers
    *   `metadata` — optional key-value object
    *   `tags` — optional array of strings

---

## 🔌 WebSocket Protocol

Connect to the WebSocket server at `ws://localhost:8000/ws`. All messages are JSON.

### Client → Server Messages

#### Subscribe to Match
```json
{
  "type": "subscribe",
  "matchId": 3
}
```

#### Unsubscribe from Match
```json
{
  "type": "unsubscribe",
  "matchId": 3
}
```

> **Note**: `matchId` can be sent as a number or numeric string (it is coerced to an integer). The field can also be named `match` instead of `matchId`.

### Server → Client Messages

#### Welcome (on connection)
```json
{
  "type": "welcome"
}
```

#### Subscribed Confirmation
```json
{
  "type": "subscribed",
  "matchId": 3
}
```

#### Unsubscribed Confirmation
```json
{
  "type": "unsubscribed",
  "matchId": 3
}
```

#### Match Created (broadcast to all)
```json
{
  "type": "match_created",
  "data": {
    "id": 4,
    "sport": "football",
    "homeTeam": "Man United",
    "awayTeam": "Man City",
    "status": "scheduled",
    "startTime": "2026-07-15T01:43:00.000Z",
    "endTime": "2026-07-15T03:43:00.000Z",
    "homeScore": 0,
    "awayScore": 0,
    "createdAt": "2026-07-15T00:00:00.000Z"
  }
}
```

#### Commentary Update (broadcast to match subscribers)
```json
{
  "type": "commentary",
  "data": {
    "id": 1,
    "matchId": 3,
    "minute": 42,
    "sequence": 120,
    "period": "2nd half",
    "eventType": "goal",
    "actor": "Alex Morgan",
    "team": "FC Neon",
    "message": "GOAL! Powerful finish from the edge of the box.",
    "metadata": { "assist": "Sam Kerr" },
    "tags": ["goal", "shot"],
    "createdAt": "2026-07-11T10:48:35.000Z"
  }
}
```

#### Error
```json
{
  "type": "error",
  "message": "Invalid JSON"
}
```

---

## 🛡️ Validation Schemas (Zod)

Both HTTP requests and WebSocket payloads are validated at runtime via Zod.

### Match Validation (`src/validation/matches.js`)

```javascript
export const createMatchSchema = z.object({
  sport: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  startTime: z.string().refine(isISODate),
  endTime: z.string().refine(isISODate),
  homeScore: z.coerce.number().int().nonnegative().optional(),
  awayScore: z.coerce.number().int().nonnegative().optional(),
}).superRefine(/* endTime must be after startTime */);

export const listMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const matchIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
```

### Commentary Validation (`src/validation/commentary.js`)

```javascript
export const createCommentarySchema = z.object({
  minute: z.number().int().nonnegative(),
  sequence: z.number().int().optional(),
  period: z.string().optional(),
  eventType: z.string().optional(),
  actor: z.string().optional(),
  team: z.string().optional(),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).optional(),
});

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});
```

---

## 📈 Monitoring — Site24x7 APM

The application integrates Site24x7 APM via the `apminsight` Node.js agent, configured in `apminsightnode.json`. The agent is loaded at the very top of the entry point (`src/index.js`) before any other imports, enabling automatic instrumentation of Express routes, database queries, and HTTP calls.

---

## 🌱 Database Seeding

The project includes a comprehensive seeding system that populates the database with realistic match and commentary data via the REST API.

### Seed Data
Match and commentary data is stored in `src/data/data.json` (≈392 KB) and includes multiple pre-configured matches with full commentary feeds.

### Running the Seeder
```bash
npm run db:seed
# or
npm run seed
```

### Seed Configuration (via `.env`)
| Variable | Default | Description |
| :--- | :--- | :--- |
| `API_URL` | — | **Required**. Base URL of the running API server |
| `DELAY_MS` | `250` | Milliseconds between each commentary post |
| `BROADCAST` | `1` | Enable/disable WebSocket broadcasts during seeding |
| `MATCH_COUNT` | `0` | Number of matches to seed (0 = all) |
| `SEED_MATCH_DURATION_MINUTES` | `120` | Default match duration in minutes |
| `SEED_FORCE_LIVE` | `true` | Force matches to have `live` status during seeding |

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18+)
*   PostgreSQL (or a [Neon](https://neon.tech) account for cloud-hosted Postgres)
*   Arcjet Account & API Key

### Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Shikharyadav25/MatchSocket.git
    cd MatchSocket
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Environment Variables (`.env`)**:
    Create a `.env` file in the root directory:
    ```env
    DATABASE_URL=postgresql://user:password@localhost:5432/score_db
    PORT=8000
    HOST=0.0.0.0

    ARCJET_KEY=ajkey_xxxxxxxxxxxxxxxxxxxxxxxxxx
    ARCJET_ENV=development
    ARCJET_MODE=DRY_RUN

    API_URL=http://localhost:8000
    BROADCAST=1
    DELAY_MS=250
    MATCH_COUNT=0
    ```

4.  **Database Migrations**:
    ```bash
    npm run db:generate
    npm run db:migrate
    ```

5.  **Run Development Server**:
    ```bash
    npm run dev
    ```
    The server starts on `http://localhost:8000` with the WebSocket endpoint at `ws://localhost:8000/ws`.

6.  **Seed the Database** (optional, requires the server to be running):
    ```bash
    npm run db:seed
    ```

### Additional Scripts

| Script | Command | Description |
| :--- | :--- | :--- |
| **Dev Server** | `npm run dev` | Start with `--watch` for auto-reload |
| **Production** | `npm start` | Start without file watching |
| **Generate Migrations** | `npm run db:generate` | Generate SQL migrations from schema changes |
| **Run Migrations** | `npm run db:migrate` | Apply pending migrations to the database |
| **Seed Data** | `npm run db:seed` | Populate the database with sample match & commentary data |
| **Drizzle Studio** | `npm run db:studio` | Launch the Drizzle Studio GUI for database exploration |
| **CRUD Demo** | `npm run demo` | Run a standalone CRUD demonstration script |

### API Testing

An `api-tests.http` file is included in the project root for use with REST client extensions (e.g., VS Code REST Client). It contains pre-configured requests for creating matches, listing matches, posting commentary, and listing commentary.

---

## 📁 Project Structure

```
MatchSocket/
├── drizzle/                    # Generated SQL migration files
│   └── 0000_*.sql
├── drizzle.config.js           # Drizzle Kit configuration
├── apminsightnode.json         # Site24x7 APM agent configuration
├── api-tests.http              # REST client test requests
├── package.json
├── .env                        # Environment variables (git-ignored)
├── .gitignore
└── src/
    ├── index.js                # Application entry point
    ├── arcjet.js               # Arcjet security (HTTP + WS instances)
    ├── db/
    │   ├── schema.js           # Drizzle ORM table & enum definitions
    │   └── db.js               # Database connection (pg Pool + Drizzle)
    ├── routes/
    │   ├── matches.js          # GET/POST /matches
    │   └── commentary.js       # GET/POST /matches/:id/commentary
    ├── validation/
    │   ├── matches.js          # Zod schemas for match payloads
    │   └── commentary.js       # Zod schemas for commentary payloads
    ├── ws/
    │   └── server.js           # WebSocket server, subscriptions & broadcasts
    ├── utils/
    │   └── match-status.js     # Match status auto-calculation utility
    ├── seed/
    │   └── seed.js             # Database seeder (posts via REST API)
    └── data/
        └── data.json           # Sample match & commentary seed data
```
