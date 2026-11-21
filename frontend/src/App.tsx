import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout';
import { AnalyticsView } from './components/AnalyticsView';
import { MemberDirectoryView } from './components/MemberDirectoryView';
import { EnforcementPanel } from './components/EnforcementPanel';
import { ChannelsRolesView } from './components/ChannelsRolesView';
import { AuditLogView } from './components/AuditLogView';

export interface User {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  accessToken: string;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  bot_in_guild: boolean;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [activeGuild, setActiveGuild] = useState<Guild | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'landing' | 'servers' | 'dashboard'>('landing');
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'enforcement' | 'channels' | 'audit'>('overview');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync session state on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    if (authError) {
      if (authError === 'auth_denied') setErrorMessage('Discord authorization was rejected.');
      else if (authError === 'invalid_state') setErrorMessage('Security check failed (CSRF state mismatch).');
      else setErrorMessage('An authentication error occurred. Please try again.');
      // Clean query parameter from address bar
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuthSession();
  }, []);

  // Fetch servers list once user is verified
  useEffect(() => {
    if (user) {
      fetchGuilds();
    }
  }, [user]);

  const checkAuthSession = async () => {
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
        setView('servers');
      } else {
        setUser(null);
        setView('landing');
      }
    } catch (err) {
      console.error('Session sync failed:', err);
      setView('landing');
    } finally {
      setLoading(false);
    }
  };

  const fetchGuilds = async () => {
    try {
      const response = await fetch('/api/guilds');
      if (response.ok) {
        const data = await response.json();
        setGuilds(data);
      }
    } catch (err) {
      console.error('Failed to retrieve servers:', err);
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/auth/login');
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Login routing failed:', err);
      setErrorMessage('Failed to connect to Discord authentication portal.');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) {
        setUser(null);
        setGuilds([]);
        setActiveGuild(null);
        setView('landing');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const handleSelectGuild = (guild: Guild) => {
    if (!guild.bot_in_guild) {
      // Open Invite URL in new window
      const clientId = '1509991885060571279'; // Will be replaced by client
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot&guild_id=${guild.id}&disable_guild_select=true`;
      window.open(inviteUrl, '_blank', 'width=500,height=800');
      return;
    }
    setActiveGuild(guild);
    setActiveTab('overview');
    setView('dashboard');
  };

  // Helper to render letter icons for servers lacking custom avatar images
  const getGuildIcon = (guild: Guild, size: number = 48) => {
    if (guild.icon) {
      return (
        <img
          src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
          alt={guild.name}
          style={{ width: size, height: size, borderRadius: '50%' }}
        />
      );
    }
    const initials = guild.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
      
    // Generate simple stable color based on guild ID
    const colors = ['#5865F2', '#57F287', '#FEE75C', '#ED4245', '#EB459E'];
    const charCodeSum = guild.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const color = colors[charCodeSum % colors.length];

    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: size * 0.4,
          color: 'white'
        }}
      >
        {initials}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '15px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '3px solid rgba(88, 101, 242, 0.2)', borderTopColor: '#5865F2', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ color: 'hsl(var(--text-secondary))', fontFamily: 'Inter' }}>Synchronizing secure credentials...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // 1. RENDER LANDING PAGE
  if (view === 'landing') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', position: 'relative' }}>
        
        {/* Glow Decorator */}
        <div style={{ position: 'absolute', top: '10%', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(88,101,242,0.15) 0%, transparent 70%)', filter: 'blur(40px)', zIndex: 0 }}></div>

        <div className="glass-panel animate-fade-in" style={{ maxWidth: '650px', width: '100%', padding: '50px 40px', textAlign: 'center', zIndex: 1, position: 'relative' }}>
          
          {/* Logo Icon */}
          <div style={{ display: 'inline-flex', padding: '16px', borderRadius: '20px', background: 'rgba(88, 101, 242, 0.12)', border: '1px solid rgba(88, 101, 242, 0.25)', marginBottom: '24px' }}>
            <svg width="48" height="48" viewBox="0 0 127.14 96.36" fill="#5865F2">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5c.79-.58,1.56-1.2,2.31-1.84a74.37,74.37,0,0,0,76.54,0c.75.64,1.52,1.26,2.31,1.84a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.07,50.29,122.9,27.57,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z" />
            </svg>
          </div>

          <h1 style={{ fontSize: '38px', fontWeight: 800, marginBottom: '16px', background: 'linear-gradient(135deg, #fff 0%, #a5b4fc 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Antigravity Control
          </h1>
          <p style={{ fontSize: '16px', color: 'hsl(var(--text-secondary))', marginBottom: '32px', lineHeight: '1.6' }}>
            A premium, high-performance administrative server console utilizing the official Discord API. Orchestrate role hierachies, visualize joined trends, and deploy rate-controlled mass ban enforcement automation.
          </p>

          {errorMessage && (
            <div className="badge badge-danger" style={{ display: 'block', padding: '12px', fontSize: '13px', textTransform: 'none', borderRadius: '8px', marginBottom: '24px' }}>
              ⚠️ {errorMessage}
            </div>
          )}

          <button onClick={handleLogin} className="btn btn-primary" style={{ padding: '14px 32px', fontSize: '16px', borderRadius: '10px' }}>
            {/* Discord Icon */}
            <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor" style={{ marginRight: '6px' }}>
              <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5c.79-.58,1.56-1.2,2.31-1.84a74.37,74.37,0,0,0,76.54,0c.75.64,1.52,1.26,2.31,1.84a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.07,50.29,122.9,27.57,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z" />
            </svg>
            Connect with Discord
          </button>
        </div>
      </div>
    );
  }

  // 2. RENDER SERVER SELECTION PAGE
  if (view === 'servers') {
    return (
      <div style={{ minHeight: '100vh', padding: '60px 20px', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <div>
            <h2 style={{ fontSize: '28px', fontWeight: 700 }}>Select a Server</h2>
            <p style={{ color: 'hsl(var(--text-secondary))' }}>Choose a Discord guild to configure and manage.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                👤
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{user?.username}</div>
                <div style={{ fontSize: '11px', color: 'hsl(var(--text-secondary))' }}>Administrator</div>
              </div>
            </div>
            <button onClick={handleLogout} className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: '12px' }}>
              Sign Out
            </button>
          </div>
        </div>

        {/* Server grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {guilds.map((guild) => (
            <div
              key={guild.id}
              className="glass-card animate-fade-in"
              style={{
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <div style={{ marginBottom: '18px' }}>{getGuildIcon(guild, 64)}</div>

              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {guild.name}
              </h3>
              <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', marginBottom: '24px' }}>
                ID: {guild.id}
              </p>

              {guild.bot_in_guild ? (
                <button
                  onClick={() => handleSelectGuild(guild)}
                  className="btn btn-primary"
                  style={{ width: '100%', borderRadius: '6px', fontSize: '13px' }}
                >
                  Manage Guild
                </button>
              ) : (
                <button
                  onClick={() => handleSelectGuild(guild)}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    borderRadius: '6px',
                    borderColor: 'rgba(88, 101, 242, 0.4)',
                    color: '#8c9eff',
                    fontSize: '13px'
                  }}
                >
                  ➕ Invite Control Bot
                </button>
              )}

              {/* Bot status banner */}
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: guild.bot_in_guild ? '#57F287' : '#99aab5',
                  boxShadow: guild.bot_in_guild ? '0 0 10px #57F287' : 'none'
                }}
                title={guild.bot_in_guild ? 'Bot Online' : 'Bot Not In Guild'}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 3. RENDER FULL SERVER DASHBOARD VIEW
  if (view === 'dashboard' && activeGuild) {
    return (
      <DashboardLayout
        guild={activeGuild}
        user={user!}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onBackToServers={() => setView('servers')}
        getGuildIcon={getGuildIcon}
      >
        {activeTab === 'overview' && <AnalyticsView guildId={activeGuild.id} />}
        {activeTab === 'members' && <MemberDirectoryView guildId={activeGuild.id} />}
        {activeTab === 'enforcement' && <EnforcementPanel guildId={activeGuild.id} />}
        {activeTab === 'channels' && <ChannelsRolesView guildId={activeGuild.id} />}
        {activeTab === 'audit' && <AuditLogView guildId={activeGuild.id} />}
      </DashboardLayout>
    );
  }

  return null;
}


