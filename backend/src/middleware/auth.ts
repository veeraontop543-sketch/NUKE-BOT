import { Request, Response, NextFunction } from 'express';
import { DiscordClient, DiscordGuild } from '../discord';

// Expand express session types
declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      username: string;
      discriminator: string;
      avatar: string | null;
      accessToken: string;
    };
    guilds?: DiscordGuild[];
  }
}

// Discord permission bitwise operators (BigInt representation)
const PERMISSIONS = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
};

// Check if user has administrator or manage server permission
export function hasAdminPermissions(permissions: string): boolean {
  try {
    const perms = BigInt(permissions);
    const isAdmin = (perms & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR;
    const canManage = (perms & PERMISSIONS.MANAGE_GUILD) === PERMISSIONS.MANAGE_GUILD;
    return isAdmin || canManage;
  } catch {
    return false;
  }
}

// 1. Ensure user is authenticated
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized. Please login with Discord first.' });
  }
  next();
}

// 2. Ensure user has administration permission for the target guild ID
export async function requireGuildAdmin(req: Request, res: Response, next: NextFunction) {
  const guildId = req.params.guildId || req.params.id || req.body.guildId;
  
  if (!guildId) {
    return res.status(400).json({ error: 'Missing guild ID parameter.' });
  }

  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized. Please login with Discord first.' });
  }

  try {
    // 1. Use cached guilds in session if available
    let guilds = req.session.guilds;

    if (!guilds) {
      // Fetch user's guilds list
      guilds = await DiscordClient.getUserGuilds(req.session.user.accessToken);
      req.session.guilds = guilds;
    }

    // 2. Find target guild in user's guilds
    const targetGuild = guilds.find((g) => g.id === guildId);

    if (!targetGuild) {
      return res.status(403).json({ error: 'Access denied. You are not a member of this server.' });
    }

    // 3. Perform permission bit verification
    // Discord owner is implicitly admin.
    const isOwner = targetGuild.owner;
    const hasPerms = hasAdminPermissions(targetGuild.permissions);

    if (!isOwner && !hasPerms) {
      return res.status(403).json({ 
        error: 'Access denied. You need "Administrator" or "Manage Server" permissions to manage this server.' 
      });
    }

    // Pass guild information to the route handler
    (req as any).guild = targetGuild;
    next();
  } catch (error: any) {
    console.error(`[Auth Middleware] Permission validation error:`, error.message);
    
    // Fallback block: If client configuration credentials are not set, allow operations for local development
    if (process.env.DISCORD_CLIENT_ID === 'YOUR_DISCORD_CLIENT_ID') {
      console.log('[Auth Middleware] DEVELOPMENT MODE: Bypassing permission validation.');
      (req as any).guild = { id: guildId, name: 'Development Guild', permissions: '8' };
      return next();
    }
    
    res.status(500).json({ error: 'Failed to authenticate guild permissions.' });
  }
}
