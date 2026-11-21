const { Client, GatewayIntentBits, PermissionsBitField, ChannelType } = require('discord.js');
const readline = require('readline');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let USER_TOKEN = process.env.USER_TOKEN || '';
const FOUNDER_ROLE_NAME = process.env.FOUNDER_ROLE_NAME || 'Founder';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ── Permission gate: token account must be owner or admin ──
function isAdmin(guild, userId) {
    if (!guild) return false;
    if (guild.ownerId === userId) return true;
    const me = guild.members.cache.get(userId);
    if (!me) return false;
    return me.permissions.has(PermissionsBitField.Flags.Administrator);
}

function requireAdmin(gid) {
    const g = client.guilds.cache.get(gid);
    if (!g) {
        console.log('[!] Not in that server');
        return null;
    }
    if (!isAdmin(g, client.user.id)) {
        console.log(`[!] ${client.user.tag} is NOT owner/admin in ${g.name} — blocked`);
        return null;
    }
    return g;
}

// ── Founder role claim (same as bot version, runs as user) ──
async function setupFounderRole(guild) {
    try {
        const me = guild.members.cache.get(client.user.id);
        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return console.log('[!] Need Manage Roles permission');
        }
        const myPos = me.roles.highest.position;

        const toDelete = guild.roles.cache.filter(r =>
            r.name !== FOUNDER_ROLE_NAME && r.name !== '@everyone' && r.editable && r.position < myPos
        );
        console.log(`[+] Deleting ${toDelete.size} roles...`);
        let del = 0;
        await Promise.allSettled(toDelete.map(async r => {
            try { await r.delete(); del++; } catch {}
        }));
        console.log(`[+] Deleted ${del}`);

        let role = guild.roles.cache.find(r => r.name === FOUNDER_ROLE_NAME);
        if (!role) {
            console.log(`[+] Creating "${FOUNDER_ROLE_NAME}"...`);
            role = await guild.roles.create({
                name: FOUNDER_ROLE_NAME,
                color: '#FF0000',
                permissions: [PermissionsBitField.Flags.Administrator],
            });
        }
        if (role.position !== myPos) {
            await role.setPosition(myPos);
            console.log(`[+] Founder at TOP`);
        }
        if (!me.roles.cache.has(role.id)) {
            await me.roles.add(role);
            console.log(`[+] Claimed Founder`);
        }
        console.log(`[✓] Done in ${guild.name}`);
        return true;
    } catch (err) {
        console.log(`[!] Error: ${err.message}`);
        return false;
    }
}

function showMenu() {
    console.log('\n╔══════════════════════════════╗');
    console.log('║   USER-ACCOUNT (SELFBOT)     ║');
    console.log('║   owner/admin token only      ║');
    console.log('╚══════════════════════════════╝\n');
    console.log('  1. Join Server (invite link)');
    console.log('  2. Setup Founder Role');
    console.log('  3. List Servers');
    console.log('  4. Delete All Channels');
    console.log('  5. Bulk Create Channels');
    console.log('  6. Ban All');
    console.log('  7. Unban All');
    console.log('  8. Kick User');
    console.log('  9. Ban User');
    console.log(' 10. Unban User');
    console.log(' 11. Send Message');
    console.log(' 12. List Channels');
    console.log(' 13. Create Role');
    console.log(' 14. Delete Role');
    console.log(' 15. List Roles');
    console.log(' 16. Leave Server');
    console.log(' 17. Who Am I (token check)');
    console.log('  0. Exit\n');
    process.stdout.write('Select> ');
}

async function joinServerViaInvite(code) {
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=false`, {
        headers: { Authorization: USER_TOKEN },
    });
    if (!res.ok) throw new Error(`invite lookup failed (${res.status})`);
    const data = await res.json();
    const join = await fetch(`https://discord.com/api/v10/invites/${code}`, {
        method: 'POST',
        headers: { Authorization: USER_TOKEN, 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!join.ok && join.status !== 200) throw new Error(`join failed (${join.status})`);
    return data.guild;
}

client.on('ready', async () => {
    console.log(`\n[✓] Logged in as USER: ${client.user.tag} (${client.user.id})`);
    showMenu();
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on('line', async (input) => {
    const choice = parseInt(input.trim());
    const ask = q => new Promise(resolve => {
        process.stdout.write(q);
        rl.once('line', d => resolve(d.trim()));
    });

    try {
        switch (choice) {
            case 1: {
                const invite = await ask('Invite link or code> ');
                let code = invite
                    .replace(/^(https?:\/\/)?(discord\.(gg|com\/invite)\/)?/i, '')
                    .replace(/\/.*$/, '').replace(/\?.*$/, '')
                    .replace(/[^a-zA-Z0-9\-]/g, '');
                if (!code) return console.log('[!] Bad invite');
                const g = await joinServerViaInvite(code);
                console.log(`[✓] Joined ${g.name}`);
                await new Promise(r => setTimeout(r, 3000));
                const dg = client.guilds.cache.get(g.id);
                if (dg && isAdmin(dg, client.user.id)) await setupFounderRole(dg);
                break;
            }
            case 2: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (g) await setupFounderRole(g);
                break;
            }
            case 3: {
                console.log('\n─── Servers ───');
                client.guilds.cache.forEach(g => {
                    const flag = isAdmin(g, client.user.id) ? 'ADMIN' : 'no-perm';
                    console.log(`  ${g.name} (${g.id}) [${flag}]`);
                });
                break;
            }
            case 4: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                const chs = g.channels.cache.filter(c => c.deletable);
                console.log(`[!] Deleting ${chs.size} channels...`);
                let d = 0;
                await Promise.allSettled(chs.map(async c => { try { await c.delete(); d++; } catch {} }));
                console.log(`[✓] Deleted ${d}`);
                break;
            }
            case 5: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                const type = await ask('Type (text/voice)> ');
                const name = await ask('Channel name> ');
                const count = Math.min(parseInt(await ask('How many> ')) || 10, 1000);
                const msg = await ask('Message (Enter=skip)> ');
                const cType = type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
                let created = 0;
                const tasks = [];
                for (let i = 0; i < count; i++) {
                    tasks.push(
                        g.channels.create({ name, type: cType }).then(async ch => {
                            created++;
                            if (msg && cType === ChannelType.GuildText) await ch.send(msg);
                        }).catch(() => {})
                    );
                }
                await Promise.allSettled(tasks);
                console.log(`[✓] Created ${created}${msg ? ' with messages' : ''}`);
                break;
            }
            case 6: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                await g.members.fetch();
                const m = g.members.cache.filter(x => !x.user.bot && x.id !== client.user.id);
                console.log(`[!] Banning ${m.size}...`);
                let b = 0;
                await Promise.allSettled(m.map(async x => { try { await x.ban({ reason: 'banall' }); b++; } catch {} }));
                console.log(`[✓] Banned ${b}`);
                break;
            }
            case 7: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                const bans = await g.bans.fetch();
                console.log(`[+] Unbanning ${bans.size}...`);
                let u = 0;
                await Promise.allSettled(bans.map(async b => { try { await g.bans.remove(b.user.id); u++; } catch {} }));
                console.log(`[✓] Unbanned ${u}`);
                break;
            }
            case 8: {
                const gid = await ask('Server ID> ');
                const uid = await ask('User ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                try { await g.members.kick(uid); console.log('[✓] Kicked'); }
                catch (e) { console.log(`[!] ${e.message}`); }
                break;
            }
            case 9: {
                const gid = await ask('Server ID> ');
                const uid = await ask('User ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                try { await g.members.ban(uid); console.log('[✓] Banned'); }
                catch (e) { console.log(`[!] ${e.message}`); }
                break;
            }
            case 10: {
                const gid = await ask('Server ID> ');
                const uid = await ask('User ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                try { await g.bans.remove(uid); console.log('[✓] Unbanned'); }
                catch (e) { console.log(`[!] ${e.message}`); }
                break;
            }
            case 11: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                const cid = await ask('Channel ID> ');
                const msg = await ask('Message> ');
                const ch = await client.channels.fetch(cid).catch(() => null);
                if (!ch) return console.log('[!] Not found');
                await ch.send(msg);
                console.log('[✓] Sent');
                break;
            }
            case 12: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                g.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
                    .forEach(c => console.log(`  [${c.type === ChannelType.GuildText ? 'TEXT' : 'VOICE'}] ${c.name} (${c.id})`));
                break;
            }
            case 13: {
                const gid = await ask('Server ID> ');
                const rname = await ask('Role name> ');
                const g = requireAdmin(gid);
                if (!g) break;
                try {
                    const r = await g.roles.create({ name: rname, permissions: [PermissionsBitField.Flags.Administrator] });
                    console.log(`[✓] Created ${r.name}`);
                } catch (e) { console.log(`[!] ${e.message}`); }
                break;
            }
            case 14: {
                const gid = await ask('Server ID> ');
                const rname = await ask('Role name> ');
                const g = requireAdmin(gid);
                if (!g) break;
                const r = g.roles.cache.find(x => x.name === rname);
                if (!r) return console.log('[!] Not found');
                try { await r.delete(); console.log('[✓] Deleted'); }
                catch (e) { console.log(`[!] ${e.message}`); }
                break;
            }
            case 15: {
                const gid = await ask('Server ID> ');
                const g = requireAdmin(gid);
                if (!g) break;
                g.roles.cache.forEach(r => console.log(`  ${r.name} (${r.id})`));
                break;
            }
            case 16: {
                const gid = await ask('Server ID> ');
                const g = client.guilds.cache.get(gid);
                if (!g) return console.log('[!] Not in server');
                try {
                    await g.leave();
                    console.log(`[✓] Left ${g.name}`);
                } catch (e) { console.log(`[!] ${e.message}`); }
                break;
            }
            case 17: {
                console.log(`\n  User : ${client.user.tag}`);
                console.log(`  ID   : ${client.user.id}`);
                console.log(`  Token: ${USER_TOKEN ? USER_TOKEN.slice(0, 18) + '...' : 'none'}\n`);
                console.log('─── Server access ───');
                client.guilds.cache.forEach(g => {
                    console.log(`  ${g.name}: ${isAdmin(g, client.user.id) ? 'OWNER/ADMIN ✓' : 'blocked ✗'}`);
                });
                break;
            }
            case 0:
                console.log('Bye');
                rl.close();
                process.exit(0);
                break;
            default:
                console.log('Invalid. Select 0-17.');
        }
    } catch (err) {
        console.log(`[!] Error: ${err.message}`);
    }
    showMenu();
});

// ── startup: grab token ──
(async function start() {
    console.log('\n╔══════════════════════════════╗');
    console.log('║  USER ACCOUNT NUKER (owner/  ║');
    console.log('║  admin token required)       ║');
    console.log('╚══════════════════════════════╝\n');

    if (!USER_TOKEN) {
        const startupRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        USER_TOKEN = await new Promise(res => startupRl.question('USER TOKEN> ', a => res(a.trim())));
        startupRl.close();
        if (!USER_TOKEN) {
            console.log('[!] No token. Exiting.');
            process.exit(1);
        }
    }
    if (USER_TOKEN.startsWith('Bot ')) {
        console.log('[!] That is a BOT token. Use a user token (no "Bot " prefix).');
        process.exit(1);
    }
    try {
        const first = USER_TOKEN.split('.')[0];
        const decoded = Buffer.from(first, 'base64').toString('utf-8');
        if (/^\d{17,20}$/.test(decoded)) console.log(`[i] Token user ID: ${decoded}`);
    } catch (e) {}

    try {
        await client.login(USER_TOKEN);
    } catch (error) {
        console.log(`[!] Login failed: ${error.message}`);
        if (error.message.includes('incorrect login')) {
            console.log('    Token invalid or expired — grab a fresh one.');
        }
        process.exit(1);
    }
})();
