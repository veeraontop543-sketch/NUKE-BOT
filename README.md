# Discord Server Management Dashboard

A secure, high-performance, and visually stunning server management dashboard built with React, TypeScript, Node.js, and PostgreSQL. It utilizes the official Discord REST API v10 to inspect server metrics, manage channels/roles, query members, and execute rate-controlled mass ban or mass kick enforcements.

---

## Key Features

- 🔑 **Discord OAuth2 Authentication**: Safe login system using cryptographically verified CSRF state keys and secure session cookies.
- 📊 **Server Analytics Dashboard**: Pure-SVG glowing area and donut charts displaying join rates, category layouts, recent activities, and a dynamic Security Rating.
- 👥 **Searchable Member Directory**: Supports full-text search, role-based filtering, individual kicks/bans, and a floating multi-select bulk operations control drawer.
- 🛡️ **Administrative Enforcement Tools**: Advanced query filter builder (pruning by join time, role counts, or custom Regular Expressions) with preview lists and confirmation gates.
- 📜 **Unified Audit Trail**: Consolidated timeline merging Discord's native developer audit logs with actions executed through the dashboard.
- 🎨 **Glassmorphic Dark UI**: High-end modern styling system built entirely with custom CSS variables (no bloated CSS frameworks).

---

## Project Structure

```
d:\server nuke/
├── backend/                  # Node.js + Express + TypeScript API Server
│   ├── src/
│   │   ├── middleware/       # Permission verification and session security
│   │   ├── routes/           # REST endpoints (auth, guild resources, mass actions)
│   │   ├── db.ts             # Self-healing PostgreSQL database pool
│   │   ├── discord.ts        # Discord REST Client (with auto 429 retry)
│   │   └── server.ts         # Main Entrypoint
│   ├── package.json
│   └── tsconfig.json
├── frontend/                 # React + Vite + TypeScript Client
│   ├── src/
│   │   ├── components/       # Dashboard tabs (Analytics, Members, Enforcement, Logs)
│   │   ├── App.tsx           # Global routing and session context
│   │   ├── index.css         # Glassmorphic HSL Design System
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts        # Vite compiler with proxy settings
└── README.md                 # Project Guide (This file)
```

---

## Prerequisites

Before running the application, make sure you have installed:
1. **Node.js** (v18.0.0 or higher)
2. **PostgreSQL** (Running locally or hosted remotely)

---

## Step 1: Create a Discord Application

To integrate with the Discord API, you need credentials from the Developer Portal:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Go to the **Bot** tab on the left sidebar:
   - Click **Add Bot** and confirm.
   - Under **Privileged Gateway Intents**, enable **Guild Members Intent** (required to fetch server member lists).
   - Copy the **Bot Token** (keep this secure).
3. Go to the **OAuth2** tab on the left:
   - Under **Client Information**, copy the **Client ID** and **Client Secret**.
   - Under **Redirects**, click **Add Redirect** and insert:
     `http://localhost:5000/api/auth/callback`
   - Click **Save Changes** at the bottom.

---

## Step 2: Configure Environment Variables

1. Navigate to the `backend/` folder.
2. Rename the template file `.env.example` to `.env`.
3. Open `.env` and fill in your Discord credentials and database URL:

```env
PORT=5000
DATABASE_URL=postgresql://your_postgres_username:your_password@localhost:5432/discord_dashboard
SESSION_SECRET=a_long_random_secret_cookie_signing_string

DISCORD_CLIENT_ID=replace_with_your_oauth2_client_id
DISCORD_CLIENT_SECRET=replace_with_your_oauth2_client_secret
DISCORD_BOT_TOKEN=replace_with_your_bot_token
DISCORD_REDIRECT_URI=http://localhost:5000/api/auth/callback
FRONTEND_URL=http://localhost:5173
```

---

## Step 3: Run the Application (Development)

### A. Start the Backend API Server

The backend features **self-healing database migrations**. When started, it will automatically connect to PostgreSQL, create the `discord_dashboard` database if missing, and initialize all schema tables.

*If PostgreSQL is not running on your machine, the backend will print a warning and operate in a temporary **In-Memory database fallback mode** so you can preview the client interface immediately.*

```bash
cd backend
npm run dev
```
The server will boot on `http://localhost:5000`.

### B. Start the Frontend Client

```bash
cd frontend
npm run dev
```
Open your browser and navigate to the printed address: `http://localhost:5173`.

---

## Step 4: Add the Bot to Your Test Server

To test the management capabilities:
1. Log in via the dashboard at `http://localhost:5173`.
2. On the **Select a Server** page, any server where the Bot is not present will show an **Invite Control Bot** button.
3. Click the button to authorize and add the bot to that server (requires you to have Administrator rights in the server).
4. Once added, the dashboard will refresh, displaying a green indicator and enabling the **Manage Guild** panel.

---

## Production Deployment Guide

When preparing the application for production:

### 1. Build and Transpile Code

**Backend Compilation:**
```bash
cd backend
npm run build
```
This compiles the TypeScript files to standard JavaScript in the `backend/dist/` directory. You can start the server with `npm start`.

**Frontend Optimization:**
```bash
cd frontend
npm run build
```
Vite will compile and bundle all React assets into `frontend/dist/`. These static assets can be served directly by Express or uploaded to a CDN.

### 2. Connect the Build Layers (Optional)
To serve both client and API from a single server port in production, configure Express to host the frontend static folder:
```typescript
// Add inside backend/src/server.ts
import path from 'path';
app.use(express.static(path.join(__dirname, '../../frontend/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});
```

### 3. Production Environment Checklist
- Change `SESSION_SECRET` to a cryptographically secure random key.
- Set `cookie.secure = true` in `backend/src/server.ts` session configuration (requires your server to have an SSL certificate).
- Adjust `FRONTEND_URL` and `DISCORD_REDIRECT_URI` to point to your live website domain.
- Ensure your production PostgreSQL database is backed up regularly and has connections pooled.
