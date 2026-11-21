import express from 'express';
import session from 'express-session';
import cors from 'cors';
import * as dotenv from 'dotenv';
import pgSimple from 'connect-pg-simple';
import { db } from './db';
import authRouter from './routes/auth';
import guildsRouter from './routes/guilds';
import adminRouter from './routes/admin';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const SESSION_SECRET = process.env.SESSION_SECRET || 'super_secret_discord_dashboard_session_key_123456';

async function bootstrap() {
  console.log('[Server] Starting Discord Server Management Dashboard Backend...');
  
  // 1. Initialize Database & Run Migrations
  await db.initialize();

  // 2. Setup Express Middlewares
  app.use(express.json());
  
  // Dynamic CORS configuration allowing cookie sharing
  app.use(
    cors({
      origin: FRONTEND_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    })
  );

  // 3. Setup Session Storage based on DB status (Memory vs PostgreSQL)
  let sessionStore;
  if (!db.isFallback()) {
    console.log('[Server] Using PostgreSQL Session Storage.');
    const PgStore = pgSimple(session);
    sessionStore = new PgStore({
      pool: db.getPool(),
      tableName: 'session'
    });
  } else {
    console.log('[Server] PostgreSQL unavailable. Falling back to In-Memory Session Storage.');
  }

  app.use(
    session({
      store: sessionStore, // will default to MemoryStore if undefined
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: 'connect.sid',
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Days duration
        httpOnly: true,
        secure: false, // Set to true if deploying over HTTPS
        sameSite: 'lax'
      }
    })
  );

  // 4. Mount API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/guilds', guildsRouter);
  app.use('/api/guilds', adminRouter); // Mount administrative control routes

  // 5. Basic Health Check
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      database: db.isFallback() ? 'in-memory-fallback' : 'postgresql-pool',
      uptime: process.uptime()
    });
  });

  // 6. Start listening
  const server = app.listen(PORT, () => {
    console.log(`[Server] Backend API running at http://localhost:${PORT}`);
    console.log(`[Server] CORS configured to accept requests from: ${FRONTEND_URL}`);
  });

  // Graceful shutdown handling
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('[Server] Closed remaining connections.');
      process.exit(0);
    });
  });
}

bootstrap().catch((err) => {
  console.error('[Server] Critical bootstrap failure:', err);
  process.exit(1);
});
