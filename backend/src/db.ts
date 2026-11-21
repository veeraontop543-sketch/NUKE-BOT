import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/discord_dashboard';

// Determine if we are in memory fallback mode
let isFallbackMode = false;
let fallbackDb: {
  users: any[];
  guild_settings: any[];
  moderation_logs: any[];
  sessions: { [key: string]: any };
} = {
  users: [],
  guild_settings: [],
  moderation_logs: [],
  sessions: {}
};

let pool: Pool;

// Parse connection URL to get base connection credentials for auto-creation
function getBaseConnectionString(uri: string): { baseUri: string; dbName: string } {
  try {
    const url = new URL(uri);
    const dbName = url.pathname.slice(1) || 'discord_dashboard';
    url.pathname = '/postgres'; // Connect to default postgres DB first to create database if missing
    return { baseUri: url.toString(), dbName };
  } catch (e) {
    // Fallback if URL parsing fails (e.g. not a valid URI)
    return { baseUri: 'postgresql://postgres:postgres@localhost:5432/postgres', dbName: 'discord_dashboard' };
  }
}

async function initializeDatabase() {
  const { baseUri, dbName } = getBaseConnectionString(connectionString);

  // Try standard connection
  pool = new Pool({
    connectionString: connectionString,
    connectionTimeoutMillis: 5000
  });

  try {
    // Test connection
    const client = await pool.connect();
    console.log(`[Database] Connected successfully to PostgreSQL database: "${dbName}"`);
    client.release();
  } catch (err: any) {
    if (err.code === '3D000') { // Database does not exist
      console.log(`[Database] Database "${dbName}" does not exist. Attempting to create it...`);
      const sysPool = new Pool({ connectionString: baseUri });
      try {
        await sysPool.query(`CREATE DATABASE ${dbName}`);
        console.log(`[Database] Database "${dbName}" created successfully.`);
        await sysPool.end();
        
        // Re-initialize pool
        pool = new Pool({ connectionString });
      } catch (createErr) {
        console.error('[Database] Failed to auto-create database:', createErr);
        sysPool.end();
        activateFallbackMode();
        return;
      }
    } else {
      console.error(`[Database] PostgreSQL connection failed (Code: ${err.code || 'UNKNOWN'}). Reason:`, err.message);
      activateFallbackMode();
      return;
    }
  }

  // Create tables if they do not exist
  try {
    await createTables();
  } catch (tableErr: any) {
    console.error('[Database] Schema migration failed:', tableErr.message);
  }
}

function activateFallbackMode() {
  isFallbackMode = true;
  console.warn('\x1b[33m%s\x1b[0m', '========================================================================');
  console.warn('\x1b[33m%s\x1b[0m', '[Database WARNING] PostgreSQL is not running or accessible.');
  console.warn('\x1b[33m%s\x1b[0m', 'Backend will operate in temporary IN-MEMORY mode for demonstration.');
  console.warn('\x1b[33m%s\x1b[0m', 'Data will NOT persist across server restarts.');
  console.warn('\x1b[33m%s\x1b[0m', '========================================================================');
}

async function createTables() {
  const client = await pool.connect();
  try {
    console.log('[Database] Running table schema checks and migrations...');
    
    // Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        discord_id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        discriminator VARCHAR(10) NOT NULL,
        avatar VARCHAR(255),
        access_token VARCHAR(255) NOT NULL,
        refresh_token VARCHAR(255) NOT NULL,
        token_expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Guild Settings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id VARCHAR(64) PRIMARY KEY,
        prefix VARCHAR(5) DEFAULT '!',
        muted_role_id VARCHAR(64),
        log_channel_id VARCHAR(64),
        welcome_message TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create Moderation Logs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS moderation_logs (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(64) NOT NULL,
        action_type VARCHAR(20) NOT NULL,
        target_id VARCHAR(64) NOT NULL,
        target_tag VARCHAR(100) NOT NULL,
        executor_id VARCHAR(64) NOT NULL,
        executor_tag VARCHAR(100) NOT NULL,
        reason TEXT,
        details JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create session table for connect-pg-simple
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
      
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    console.log('[Database] Schema verified. All database tables are ready.');
  } finally {
    client.release();
  }
}

// Unified Query interface that handles DB operations and transparent memory-fallback operations
export const db = {
  query: async (text: string, params?: any[]) => {
    if (isFallbackMode) {
      return queryFallback(text, params);
    }
    return pool.query(text, params);
  },
  getPool: () => pool,
  isFallback: () => isFallbackMode,
  initialize: initializeDatabase
};

// Simplified in-memory query parser to mock SQL CRUD operations in fallback mode
function queryFallback(text: string, params?: any[]): any {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  const p = params || [];

  // MOCK USER INSERT/UPSERT
  if (normalized.includes('insert into users') || normalized.includes('users (discord_id')) {
    // Upsert behavior
    const user = {
      discord_id: p[0],
      username: p[1],
      discriminator: p[2],
      avatar: p[3],
      access_token: p[4],
      refresh_token: p[5],
      token_expires_at: p[6],
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const idx = fallbackDb.users.findIndex(u => u.discord_id === user.discord_id);
    if (idx >= 0) {
      fallbackDb.users[idx] = { ...fallbackDb.users[idx], ...user };
    } else {
      fallbackDb.users.push(user);
    }
    return { rows: [user], rowCount: 1 };
  }

  // SELECT USER
  if (normalized.includes('select') && normalized.includes('from users')) {
    if (normalized.includes('where discord_id =')) {
      const id = p[0];
      const user = fallbackDb.users.find(u => u.discord_id === id);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
    return { rows: fallbackDb.users, rowCount: fallbackDb.users.length };
  }

  // GUILD CONFIGS
  if (normalized.includes('select') && normalized.includes('from guild_settings')) {
    const id = p[0];
    const settings = fallbackDb.guild_settings.find(s => s.guild_id === id);
    if (!settings) {
      // Return default config
      const defaultSettings = { guild_id: id, prefix: '!', muted_role_id: null, log_channel_id: null, welcome_message: null };
      return { rows: [defaultSettings], rowCount: 1 };
    }
    return { rows: [settings], rowCount: 1 };
  }

  if (normalized.includes('insert into guild_settings') || normalized.includes('update guild_settings')) {
    const settings = {
      guild_id: p[0],
      prefix: p[1] || '!',
      muted_role_id: p[2] || null,
      log_channel_id: p[3] || null,
      welcome_message: p[4] || null,
      updated_at: new Date()
    };
    const idx = fallbackDb.guild_settings.findIndex(s => s.guild_id === settings.guild_id);
    if (idx >= 0) {
      fallbackDb.guild_settings[idx] = { ...fallbackDb.guild_settings[idx], ...settings };
    } else {
      fallbackDb.guild_settings.push(settings);
    }
    return { rows: [settings], rowCount: 1 };
  }

  // MODERATION LOGS INSERT
  if (normalized.includes('insert into moderation_logs')) {
    const log = {
      id: fallbackDb.moderation_logs.length + 1,
      guild_id: p[0],
      action_type: p[1],
      target_id: p[2],
      target_tag: p[3],
      executor_id: p[4],
      executor_tag: p[5],
      reason: p[6],
      details: p[7] ? JSON.parse(p[7]) : null,
      timestamp: new Date()
    };
    fallbackDb.moderation_logs.push(log);
    return { rows: [log], rowCount: 1 };
  }

  // SELECT MODERATION LOGS
  if (normalized.includes('select') && normalized.includes('from moderation_logs')) {
    const guildId = p[0];
    const logs = fallbackDb.moderation_logs.filter(l => l.guild_id === guildId);
    // Sort descending by timestamp/id
    logs.sort((a, b) => b.id - a.id);
    return { rows: logs, rowCount: logs.length };
  }

  // Default response to prevent crashes
  return { rows: [], rowCount: 0 };
}
