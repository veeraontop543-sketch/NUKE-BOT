import { useState, useEffect } from 'react';

interface AnalyticsData {
  summary: {
    totalMembers: number;
    rolesCount: number;
    channelsCount: number;
    textCount: number;
    voiceCount: number;
    categoriesCount: number;
    securityScore: number;
  };
  roleDistribution: { name: string; count: number; color: string }[];
  joinsHistory: { date: string; joins: number }[];
  recentActivity: { user: string; action: string; time: string }[];
}

export function AnalyticsView({ guildId }: { guildId: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [guildId]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/guilds/${guildId}/analytics`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (err) {
      console.error('Analytics load error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
        {/* Skeleton grid cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card skeleton" style={{ height: '110px' }} />
          ))}
        </div>
        {/* Skeleton chart panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div className="glass-card skeleton" style={{ height: '320px' }} />
          <div className="glass-card skeleton" style={{ height: '320px' }} />
        </div>
      </div>
    );
  }

  if (!data) return <div>Failed to load server analytics.</div>;

  // Compile coordinates for join area trend chart
  const joins = data.joinsHistory.map((j) => j.joins);
  const maxJoins = Math.max(...joins, 5); // Ensure no divide by zero and nice spacing
  const chartHeight = 160;
  const chartWidth = 500;
  const points = data.joinsHistory.map((h, i) => {
    const x = (i / (data.joinsHistory.length - 1)) * chartWidth;
    const y = chartHeight - (h.joins / maxJoins) * (chartHeight - 30) - 15;
    return { x, y, ...h };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const fillPath = linePath ? `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }} className="animate-fade-in">
      
      {/* 1. OVERVIEW COUNTER CARDS */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        
        {/* Card 1: Members */}
        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(88, 101, 242, 0.1)', color: '#5865F2' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Total Members</div>
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginTop: '2px' }}>{data.summary.totalMembers}</h3>
          </div>
        </div>

        {/* Card 2: Channels */}
        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(87, 242, 135, 0.1)', color: '#57F287' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Active Channels</div>
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginTop: '2px' }}>{data.summary.channelsCount}</h3>
          </div>
        </div>

        {/* Card 3: Roles */}
        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(254, 231, 92, 0.1)', color: '#FEE75C' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Server Roles</div>
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginTop: '2px' }}>{data.summary.rolesCount}</h3>
          </div>
        </div>

        {/* Card 4: Security Score */}
        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(237, 66, 69, 0.1)', color: '#ED4245' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Security Score</div>
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginTop: '2px', color: data.summary.securityScore > 80 ? '#57F287' : '#FEE75C' }}>
              {data.summary.securityScore} <span style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 400 }}>/ 100</span>
            </h3>
          </div>
        </div>

      </section>

      {/* 2. TRENDS CHARTS SECTION */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        
        {/* Main Area Chart: Member Join Trends */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Member Growth Trend</h3>
            <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>Daily joins captured over the last 7 days</p>
          </div>

          <div style={{ position: 'relative', width: '100%', height: `${chartHeight}px`, marginTop: '10px' }}>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%" height="100%" preserveAspectRatio="none">
              
              <defs>
                {/* Glowing area gradient */}
                <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5865F2" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#5865F2" stopOpacity="0.0" />
                </linearGradient>
                {/* Glowing line stroke */}
                <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#8c9eff" />
                  <stop offset="100%" stopColor="#5865F2" />
                </linearGradient>
              </defs>

              {/* Horizontal guide lines */}
              <line x1="0" y1={chartHeight * 0.25} x2={chartWidth} y2={chartHeight * 0.25} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
              <line x1="0" y1={chartHeight * 0.5} x2={chartWidth} y2={chartHeight * 0.5} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
              <line x1="0" y1={chartHeight * 0.75} x2={chartWidth} y2={chartHeight * 0.75} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />

              {/* Area Fill */}
              {fillPath && <path d={fillPath} fill="url(#chartGlow)" />}

              {/* Line path */}
              {linePath && <path d={linePath} fill="none" stroke="url(#lineGlow)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}

              {/* Data Nodes */}
              {points.map((p, idx) => (
                <g key={idx}>
                  <circle cx={p.x} cy={p.y} r="5" fill="#5865F2" stroke="white" strokeWidth="1.5" />
                  <text x={p.x} y={p.y - 12} textAnchor="middle" fill="white" fontSize="10" fontWeight="600">{p.joins}</text>
                </g>
              ))}

            </svg>
          </div>

          {/* X Axis Labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 5px', fontSize: '11px', color: 'hsl(var(--text-secondary))' }}>
            {data.joinsHistory.map((h, i) => (
              <span key={i}>{h.date}</span>
            ))}
          </div>
        </div>

        {/* Channels Breakdown Donut Panel */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Channel Distribution</h3>
            <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>Guild category structures</p>
          </div>

          {/* Simple Dynamic SVG Donut */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px' }}>
            <svg width="120" height="120" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
              
              {/* Text channels: 50% circle */}
              <circle
                cx="20"
                cy="20"
                r="15.915"
                fill="transparent"
                stroke="#5865F2"
                strokeWidth="4.5"
                strokeDasharray="50 100"
                strokeDashoffset="25"
              />
              
              {/* Voice channels: 30% circle */}
              <circle
                cx="20"
                cy="20"
                r="15.915"
                fill="transparent"
                stroke="#57F287"
                strokeWidth="4.5"
                strokeDasharray="30 100"
                strokeDashoffset="75"
              />

              {/* Categories: 20% circle */}
              <circle
                cx="20"
                cy="20"
                r="15.915"
                fill="transparent"
                stroke="#FEE75C"
                strokeWidth="4.5"
                strokeDasharray="20 100"
                strokeDashoffset="5"
              />
            </svg>
          </div>

          {/* Donut Legend */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#5865F2' }} />
                Text Channels
              </span>
              <strong style={{ color: 'white' }}>{data.summary.textCount}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#57F287' }} />
                Voice Channels
              </span>
              <strong style={{ color: 'white' }}>{data.summary.voiceCount}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FEE75C' }} />
                Categories
              </span>
              <strong style={{ color: 'white' }}>{data.summary.categoriesCount}</strong>
            </div>
          </div>
        </div>

      </section>

      {/* 3. RECENT ACTIVITY STREAM */}
      <section className="glass-panel" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Recent Console Activity</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {data.recentActivity.map((act, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '8px',
                border: '1px solid rgba(var(--border-glass))'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#5865F2' }} />
                <div>
                  <span style={{ fontWeight: 600, color: 'white', marginRight: '6px' }}>{act.user}</span>
                  <span style={{ color: 'hsl(var(--text-secondary))', fontSize: '13px' }}>{act.action}</span>
                </div>
              </div>
              <span style={{ fontSize: '11px', color: 'hsl(var(--text-dark))' }}>{act.time}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
