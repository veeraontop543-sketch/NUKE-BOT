// ──────────────────────────────────────────────
// STARTUP - Ask for token & invite
// ──────────────────────────────────────────────
async function startBot() {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║      DISCORD USER ACCOUNT BOT (SELFBOT)     ║`);
    console.log(`║  ⚠️  For educational/testing purposes only   ║`);
    console.log(`║  User accounts may violate Discord ToS       ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);

    // Use a temporary readline for startup prompts only
    const startupRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    if (!USER_TOKEN) {
        console.log('[!] No user token found in .env file');
        const token = await new Promise((resolve) => {
            startupRl.question('USER TOKEN> ', (answer) => {
                resolve(answer.trim());
            });
        });

        if (!token) {
            console.log('[!] No token provided. Exiting.');
            startupRl.close();
            process.exit(1);
        }

        USER_TOKEN = token;
        console.log('[+] Token received.');
    }

    // Check if token starts with "Bot " and warn
    if (USER_TOKEN.startsWith('Bot ')) {
        console.log('[!] This looks like a BOT token (starts with "Bot ").');
        console.log('    For selfbot mode, you need a USER token (no prefix).');
        console.log('    Continuing anyway but may not work...\n');
    }

    // Try to extract user info from token
    try {
        const parts = USER_TOKEN.split('.');
        if (parts.length >= 1) {
            const firstPart = parts[0];
            // Base64 decode the first part (user ID in newer tokens)
            try {
                const decoded = Buffer.from(firstPart, 'base64').toString('utf-8');
                console.log(`[i] Token user ID (decoded): ${decoded}`);
            } catch (e) {
                // Not base64, might be a different format
            }
        }
    } catch (e) {
        // ignore
    }

    const inviteInput = await new Promise((resolve) => {
        startupRl.question('INVITE LINK (optional)> ', (answer) => {
            resolve(answer.trim());
        });
    });

    // Close startup readline before login and command loop
    startupRl.close();

    let inviteCode = null;
    if (inviteInput) {
        // Extract invite code
        let code = inviteInput;
        code = code.replace(/^(https?:\/\/)?(discord\.(gg|com\/invite)\/)?/i, '');
        code = code.replace(/\/.*$/, '').replace(/\?.*$/, '');
        code = code.replace(/[^a-zA-Z0-9\-]/g, '');
        if (code) {
            inviteCode = code;
        }
    }

    // Login as user
    console.log('\n[+] Logging in as user account...');
    try {
        await client.login(USER_TOKEN);
        
        // If an invite was provided, join the server after login
        if (inviteCode) {
            console.log(`\n[+] Joining server via invite code: ${inviteCode}...`);
            const guild = await joinServerViaInvite(inviteCode);
            
            if (guild) {
                // Wait for guild to sync
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const discordGuild = client.guilds.cache.get(guild.id);
                if (discordGuild) {
                    console.log(`\n[+] Checking for "${FOUNDER_ROLE_NAME}" role...`);
                    const role = await claimFounderRole(discordGuild);
                    if (role) {
                        protectedGuilds.add(guild.id);
                        setupRoleProtection(discordGuild, role);
                        console.log(`[✓] Done! "${FOUNDER_ROLE_NAME}" role claimed and protected!`);
                    } else {
                        console.log(`[i] No "${FOUNDER_ROLE_NAME}" role found.`);
                        console.log(`    Create a role named "${FOUNDER_ROLE_NAME}" and type "claim ${guild.id}"`);
                    }
                }
            }
        }
    } catch (error) {
        console.log(`[!] Failed to login: ${error.message}`);
        if (error.message.includes('incorrect login')) {
            console.log('    The user token is invalid or expired. Please get a new one.');
        }
        process.exit(1);
    }
}

startBot();