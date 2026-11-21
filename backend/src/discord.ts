import axios, { AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const API_ENDPOINT = 'https://discord.com/api/v10';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const USER_TOKEN = process.env.DISCORD_USER_TOKEN || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';

// Determine which token mode to use: User token (selfbot) or Bot token
let AUTH_TOKEN: string;
let AUTH_MODE: 'bot' | 'user';

if (USER_TOKEN) {
    AUTH_TOKEN = USER_TOKEN;
    AUTH_MODE = 'user';
} else if (BOT_TOKEN) {
    AUTH_TOKEN = BOT_TOKEN;
    AUTH_MODE = 'bot';
} else {
    throw new Error('No Discord token provided. Set DISCORD_BOT_TOKEN or DISCORD_USER_TOKEN in .env');
}

// Type Definitions
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  email?: string;
  mfa_enabled?: boolean;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
  approximate_member_count?: number;
  bot_in_guild?: boolean;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = Text, 2 = Voice, 4 = Category, etc.
  position: number;
  parent_id: string | null;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
  member_count?: number;
}

export interface DiscordMember {
  user: DiscordUser;
  nick: string | null;
  avatar: string | null;
  roles: string[];
  joined_at: string;
  deaf: boolean;
  mute: boolean;
  pending?: boolean;
  communication_disabled_until?: string | null; // For timeouts
}

export interface DiscordAuditLogEntry {
  id: string;
  action_type: number;
  user_id: string | null; // Executor
  target_id: string | null;
  reason?: string;
  changes?: any[];
}

// Bot client instance with rate-limiting support
const discordClient: AxiosInstance = axios.create({
  baseURL: API_ENDPOINT,
  headers: {
    Authorization: AUTH_MODE === 'bot' ? `Bot ${AUTH_TOKEN}` : AUTH_TOKEN,
    'Content-Type': 'application/json'
  },
});

// Axios response interceptor for handling Discord rate-limiting (429) automatically
discordClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 429 && !originalRequest._retry) {
      originalRequest._retry = true;
      const retryAfter = (error.response.data.retry_after || 1) * 1000;
      console.warn(`[Discord API] Rate limited (429). Retrying after ${retryAfter}ms...`);
      
      // Delay execution
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      
      // Re-run original request
      return discordClient(originalRequest);
    }
    return Promise.reject(error);
  }
);

export class DiscordClient {
  // OAuth2 Token Exchange
  static async exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);

    const response = await axios.post(`${API_ENDPOINT}/oauth2/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return response.data;
  }

  // Refresh OAuth2 Token
  static async refreshToken(refreshTokenString: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshTokenString);

    const response = await axios.post(`${API_ENDPOINT}/oauth2/token`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return response.data;
  }

  // Fetch User Identity using OAuth2 token
  static async getUserProfile(accessToken: string): Promise<DiscordUser> {
    const response = await axios.get(`${API_ENDPOINT}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  }

  // Fetch User's Guild list using OAuth2 token
  static async getUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
    const response = await axios.get(`${API_ENDPOINT}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  }

  // BOT/USER API: Verify if the account is in a guild
  static async isInGuild(guildId: string): Promise<boolean> {
    try {
      await discordClient.get(`/guilds/${guildId}`);
      return true;
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        return false;
      }
      // If unauthorized, token is wrong, but let's return false safely
      return false;
    }
  }

  // BOT/USER API: Fetch Guild info
  static async getGuild(guildId: string): Promise<any> {
    const response = await discordClient.get(`/guilds/${guildId}`);
    return response.data;
  }

  // BOT/USER API: Fetch Guild Channels
  static async getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
    const response = await discordClient.get(`/guilds/${guildId}/channels`);
    return response.data;
  }

  // BOT/USER API: Fetch Guild Roles
  static async getGuildRoles(guildId: string): Promise<DiscordRole[]> {
    const response = await discordClient.get(`/guilds/${guildId}/roles`);
    const roles: DiscordRole[] = response.data;
    
    // Sort roles in hierarchy (higher position first)
    return roles.sort((a, b) => b.position - a.position);
  }

  // BOT/USER API: Fetch Guild Members (paginated, fetches up to 1000 members)
  static async getGuildMembers(guildId: string, limit: number = 1000, after: string = '0'): Promise<DiscordMember[]> {
    try {
      const response = await discordClient.get(`/guilds/${guildId}/members`, {
        params: { limit, after }
      });
      return response.data;
    } catch (error: any) {
      console.error(`[Discord API] Error fetching members for guild ${guildId}:`, error.message);
      // Return mock members if using placeholder mock mode for testing
      if (BOT_TOKEN === 'YOUR_DISCORD_BOT_TOKEN' && !USER_TOKEN) {
        return this.getMockMembers();
      }
      throw error;
    }
  }

  // BOT/USER API: Fetch Discord Audit Logs
  static async getGuildAuditLogs(guildId: string, limit: number = 50): Promise<DiscordAuditLogEntry[]> {
    try {
      const response = await discordClient.get(`/guilds/${guildId}/audit-logs`, {
        params: { limit }
      });
      return response.data.audit_log_entries || [];
    } catch (err: any) {
      console.error(`[Discord API] Error fetching audit logs:`, err.message);
      return [];
    }
  }

  // BOT/USER API: Moderate Member - Kick
  static async kickMember(guildId: string, userId: string, reason?: string): Promise<void> {
    await discordClient.delete(`/guilds/${guildId}/members/${userId}`, {
      headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}
    });
  }

  // BOT/USER API: Moderate Member - Ban
  static async banMember(guildId: string, userId: string, deleteMessageDays: number = 0, reason?: string): Promise<void> {
    await discordClient.put(`/guilds/${guildId}/bans/${userId}`, {
      delete_message_days: deleteMessageDays
    }, {
      headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}
    });
  }

  // BOT/USER API: Moderate Member - Unban
  static async unbanMember(guildId: string, userId: string, reason?: string): Promise<void> {
    await discordClient.delete(`/guilds/${guildId}/bans/${userId}`, {
      headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}
    });
  }

  // BOT/USER API: Edit Member Roles
  static async updateMemberRoles(guildId: string, userId: string, roles: string[], reason?: string): Promise<void> {
    await discordClient.patch(`/guilds/${guildId}/members/${userId}`, {
      roles
    }, {
      headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}
    });
  }

  // BOT/USER API: Timeout / Mute Member
  static async timeoutMember(guildId: string, userId: string, durationMinutes: number | null, reason?: string): Promise<void> {
    const communication_disabled_until = durationMinutes 
      ? new Date(Date.now() + durationMinutes * 60000).toISOString() 
      : null;

    await discordClient.patch(`/guilds/${guildId}/members/${userId}`, {
      communication_disabled_until
    }, {
      headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}
    });
  }

  // BOT/USER API: Create Channel
  static async createChannel(guildId: string, name: string, type: number, parentId?: string | null): Promise<any> {
    const data: any = { name, type };
    if (parentId) data.parent_id = parentId;
    const response = await discordClient.post(`/guilds/${guildId}/channels`, data);
    return response.data;
  }

  // BOT/USER API: Delete Channel
  static async deleteChannel(channelId: string): Promise<void> {
    await discordClient.delete(`/channels/${channelId}`);
  }

  // BOT/USER API: Join server via invite code (User accounts only)
  static async joinGuildViaInvite(inviteCode: string): Promise<any> {
    const response = await discordClient.post(`/invites/${inviteCode}`);
    return response.data;
  }

  // Helper to generate elegant realistic mock members for out-of-the-box local testing
  private static getMockMembers(): DiscordMember[] {
    const roles = ['100000000000000001', '100000000000000002', '100000000000000003'];
    const mockNames = [
      { user: 'NeoMatrix', tag: '0001', role: [roles[0]] },
      { user: 'AlphaGamer', tag: '4231', role: [roles[1]] },
      { user: 'ChronoTrigger', tag: '8872', role: [roles[2]] },
      { user: 'QuantumByte', tag: '1092', role: [roles[1], roles[2]] },
      { user: 'LovelaceCode', tag: '9002', role: [roles[0], roles[1]] },
      { user: 'PixelWanderer', tag: '6743', role: [] },
      { user: 'SpamBot_99', tag: '9999', role: [] },
      { user: 'WumpusFriend', tag: '1234', role: [roles[1]] },
      { user: 'CyberGlitch', tag: '5050', role: [] }
    ];

    return mockNames.map((m, idx) => ({
      user: {
        id: `80000000000000000${idx}`,
        username: m.user,
        discriminator: m.tag,
        avatar: null
      },
      nick: idx % 3 === 0 ? `Alias-${m.user}` : null,
      avatar: null,
      roles: m.role,
      joined_at: new Date(Date.now() - idx * 86400000 * 2.5).toISOString(),
      deaf: false,
      mute: false
    }));
  }

  // Get current auth mode info
  static getAuthMode(): { mode: 'bot' | 'user'; token: string } {
    return { mode: AUTH_MODE, token: AUTH_TOKEN };
  }
}