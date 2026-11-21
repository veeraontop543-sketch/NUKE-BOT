import { useState, useEffect } from 'react';

interface AuditLogEntry {
  id: string;
  source: 'dashboard' | 'discord';
  action_type: string;
  executor: { id: string; tag: string };
  target: { id: string; tag: string };
  reason: string;
  details?: any;
  timestamp: string;
}

export function AuditLogView({ guildId }: { guildId: string }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'dashboard' | 'discord'>('all');

  useEffect(() => {
    fetchLogs();
  }, [guildId]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/guilds/${guildId}/audit-logs`);
      if (response.ok) {
        setLogs(await response.json());
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    // Source filter
    if (sourceFilter !== 'all' && log.source !== sourceFilter) return false;

    // Search query
    const query = search.toLowerCase();
    return (
      log.action_type.toLowerCase().includes(query) ||
      log.executor.tag.toLowerCase().includes(query) ||
      log.target.tag.toLowerCase().includes(query) ||
      log.reason.toLowerCase().includes(query) ||
      log.id.includes(query)
    );
  });

  const getActionBadgeColor = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('BAN')) return 'badge-danger';
    if (act.includes('KICK') || act.includes('PRUNE')) return 'badge-warning';
    if (act.includes('ROLE') || act.includes('UPDATE')) return 'badge-success';
    return 'badge-secondary';
  };

  const getSourceBadgeStyle = (source: string) => {
    return source === 'dashboard'
      ? { backgroundColor: 'rgba(88, 101, 242, 0.12)', color: '#8c9eff', border: '1px solid rgba(88,101,242,0.25)' }
      : { backgroundColor: 'rgba(153, 170, 181, 0.12)', color: '#b9bbbe', border: '1px solid rgba(153,170,181,0.25)' };
  };

  if (loading) {
    return (
      <div className="glass-panel skeleton" style={{ width: '100%', height: '400px', borderRadius: '16px' }} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }} className="animate-fade-in">
      
      {/* 1. FILTERING HEADER BAR */}
      <section className="glass-panel" style={{ padding: '18px 24px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Action Logs</h2>

        <div style={{ display: 'flex', gap: '12px', flex: 1, maxWidth: '550px' }}>
          {/* Text Filter */}
          <input
            type="text"
            className="input-field"
            placeholder="Filter logs by action, operator, target, or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 2 }}
          />

          {/* Source Selector */}
          <select
            className="input-field"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as any)}
            style={{ flex: 1, minWidth: '130px', cursor: 'pointer' }}
          >
            <option value="all">All Sources</option>
            <option value="dashboard">Dashboard Only</option>
            <option value="discord">Discord Native</option>
          </select>
        </div>
      </section>

      {/* 2. LOG TIMELINE LIST */}
      <section className="glass-panel" style={{ padding: '24px' }}>
        {filteredLogs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: '16px',
                  background: 'rgba(255,255,255,0.015)',
                  border: '1px solid rgba(var(--border-glass))',
                  borderRadius: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                {/* Top Row: Meta and Badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    
                    {/* Source Indicator */}
                    <span className="badge" style={{ ...getSourceBadgeStyle(log.source), fontSize: '10px', textTransform: 'uppercase' }}>
                      {log.source}
                    </span>

                    {/* Action Type */}
                    <span className={`badge ${getActionBadgeColor(log.action_type)}`}>
                      {log.action_type}
                    </span>

                    <span style={{ fontSize: '11px', color: 'hsl(var(--text-dark))' }}>
                      ID: {log.id}
                    </span>

                  </div>

                  <span style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>
                    {new Date(log.timestamp).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                </div>

                {/* Content Row: Executor & Target */}
                <div style={{ fontSize: '14px', color: 'white' }}>
                  <span style={{ color: 'hsl(var(--text-secondary))' }}>Operator: </span>
                  <strong style={{ color: '#8c9eff' }}>{log.executor.tag}</strong>
                  <span style={{ color: 'hsl(var(--text-dark))', fontSize: '11px', fontFamily: 'monospace' }}> ({log.executor.id})</span>

                  <span style={{ color: 'hsl(var(--text-secondary))', margin: '0 8px' }}>➔</span>

                  <span style={{ color: 'hsl(var(--text-secondary))' }}>Target: </span>
                  <strong>{log.target.tag}</strong>
                  <span style={{ color: 'hsl(var(--text-dark))', fontSize: '11px', fontFamily: 'monospace' }}> ({log.target.id})</span>
                </div>

                {/* Reason Row */}
                <div style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', paddingLeft: '10px', borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
                  Reason: {log.reason}
                </div>

                {/* Collapsible Action Stats Details (For mass actions or role lists) */}
                {log.details && (
                  <div
                    style={{
                      background: 'rgba(0,0,0,0.15)',
                      padding: '12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      border: '1px solid rgba(255,255,255,0.03)',
                      color: 'hsl(var(--text-secondary))'
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'white', marginBottom: '4px' }}>Execution Metadata:</div>
                    {typeof log.details === 'object' ? JSON.stringify(log.details, null, 2) : log.details}
                  </div>
                )}

              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--text-secondary))' }}>
            No logs match the active query. Adjust your filters and view again.
          </div>
        )}
      </section>

    </div>
  );
}
