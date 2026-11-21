// Quick bot token test - run with: node test-bot.js
const WebSocket = require('ws');

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

async function testBot() {
  console.log('🔍 Testing bot token...');
  
  // 1. Validate token via REST
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bot ' + BOT_TOKEN }
    });
    if (!res.ok) {
      const err = await res.text();
      console.log('❌ Token invalid:', res.status, err);
      return;
    }
    const me = await res.json();
    console.log('✅ Token valid:', me.username, '#', me.discriminator, '(', me.id, ')');
  } catch (e) {
    console.log('❌ REST error:', e.message);
    return;
  }

  // 2. Try gateway connection
  console.log('\n🔌 Connecting to gateway...');
  
  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  
  ws.on('open', () => console.log('✅ WebSocket connected'));
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.op === 10) {
        console.log('✅ HELLO received, heartbeat:', msg.d.heartbeat_interval);
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: 'Bot ' + BOT_TOKEN,
            intents: 98351,
            properties: { os: 'Android', browser: 'Discord Android', device: 'mobile' },
            compress: false,
            presence: { status: 'online', since: 0, activities: [{ name: 'Test', type: 0 }], afk: false }
          }
        }));
        console.log('📤 IDENTIFY sent');
      } else if (msg.op === 0 && msg.t === 'READY') {
        console.log('✅ Bot READY on gateway!');
        console.log('🎉 SUCCESS! Bot is in', msg.d.guilds.length, 'server(s)');
        ws.close();
        process.exit(0);
      } else if (msg.op === 9) {
        console.log('❌ Invalid session (op 9) - bot not in any server or token issue');
        ws.close();
        process.exit(1);
      }
    } catch (e) {
      console.log('Message error:', e.message);
    }
  });

  ws.on('error', (err) => console.log('❌ WS Error:', err.message));
  
  ws.on('close', (code, reason) => {
    console.log('🔌 Closed:', code, reason.toString());
    if (code === 1006) {
      console.log('\n💡 This usually means: bot is not in any server');
      console.log('   Fix: Invite bot to a server via OAuth2 URL');
    }
  });

  setTimeout(() => {
    console.log('⏱ Timeout');
    ws.close();
    process.exit(1);
  }, 15000);
}

testBot();