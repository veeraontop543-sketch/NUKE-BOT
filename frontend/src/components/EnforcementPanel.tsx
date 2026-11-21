import { useState, useEffect } from 'react';

interface Member {
  user: {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
  };
  nick: string | null;
  roles: string[];
  joined_at: string;
}

export function EnforcementPanel({ guildId }: { guildId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter builders
  const [joinRangeHours, setJoinRangeHours] = useState('');
  const [hasNoRoles, setHasNoRoles] = useState(false);
  const [usernameRegex, setUsernameRegex] = useState('');
  
  // Targets Scan Results
  const [targets, setTargets] = useState<Member[]>([]);
  const [scanned, setScanned] = useState(false);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  
  // Execution
  const [executing, setExecuting] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [actionType, setActionType] = useState<'KICK' | 'BAN' | null>(null);
  const [reason, setReason] = useState('');
  const [confirmInput, setConfirmInput] = useState('');

  useEffect(() => {
    fetchData();
  }, [guildId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const membersRes = await fetch(`/api/guilds/${guildId}/members?limit=1000`);

      if (membersRes.ok) {
        const memData = await membersRes.json();
        setMembers(memData.members || []);
      }
    } catch (err) {
      console.error('Failed to load enforcement panel data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Compile active targets based on specified filters
  const handleScan = () => {
    setLoading(true);
    let matched = [...members];

    // Filter 1: Joined within last X hours
    if (joinRangeHours) {
      const hours = parseFloat(joinRangeHours);
      const thresholdTime = Date.now() - hours * 60 * 60 * 1000;
      matched = matched.filter((m) => new Date(m.joined_at).getTime() >= thresholdTime);
    }

    // Filter 2: Accounts with absolutely no roles
    if (hasNoRoles) {
      matched = matched.filter((m) => m.roles.length === 0);
    }

    // Filter 3: Regular Expression match on username
    if (usernameRegex) {
      try {
        const regex = new RegExp(usernameRegex, 'i');
        matched = matched.filter((m) => regex.test(m.user.username));
      } catch (err) {
        alert('Invalid Regular Expression entered. Please verify syntax.');
        setLoading(false);
        return;
      }
    }

    setTargets(matched);
    setExcludedIds([]);
    setScanned(true);
    setLoading(false);
  };

  const handleToggleExclude = (id: string) => {
    if (excludedIds.includes(id)) {
      setExcludedIds(excludedIds.filter((x) => x !== id));
    } else {
      setExcludedIds([...excludedIds, id]);
    }
  };

  // Pre-trigger confirmation dialog
  const handleTriggerAction = (type: 'KICK' | 'BAN') => {
    const activeTargets = targets.filter((t) => !excludedIds.includes(t.user.id));
    if (activeTargets.length === 0) {
      alert('No targets selected for execution.');
      return;
    }
    setActionType(type);
    setReason('');
    setConfirmInput('');
    setShowConfirmModal(true);
  };

  // Execute mass moderation routine
  const handleExecuteEnforcement = async () => {
    if (confirmInput !== 'CONFIRM MASS ACTION') {
      alert('Confirmation verification input is incorrect.');
      return;
    }

    const activeTargets = targets.filter((t) => !excludedIds.includes(t.user.id));
    const targetIds = activeTargets.map((t) => t.user.id);
    const targetTags = activeTargets.map((t) => `${t.user.username}#${t.user.discriminator}`);

    setShowConfirmModal(false);
    setExecuting(true);
    setProgressMsg(`Initiating rate-controlled mass ${actionType?.toLowerCase()} on ${targetIds.length} members...`);

    try {
      const endpoint = actionType === 'KICK' 
        ? `/api/guilds/${guildId}/actions/mass-kick` 
        : `/api/guilds/${guildId}/actions/mass-ban`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: targetIds,
          userTags: targetTags,
          reason
        })
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Mass action completed!\nSucceeded: ${data.summary.succeeded}\nFailed: ${data.summary.failed}`);
        setTargets([]);
        setScanned(false);
        await fetchData();
      } else {
        const errData = await response.json();
        alert(errData.error || 'Mass execution failed.');
      }
    } catch (err) {
      console.error(err);
      alert('Network timeout error.');
    } finally {
      setExecuting(false);
      setActionType(null);
    }
  };

  const activeTargets = targets.filter((t) => !excludedIds.includes(t.user.id));

  if (loading) {
    return (
      <div className="glass-panel skeleton" style={{ width: '100%', height: '450px', borderRadius: '16px' }} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }} className="animate-fade-in">
      
      {/* 1. FILTER CONTROLLER PANELS */}
      <section className="glass-panel" style={{ padding: '28px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '10px' }}>Administrative Enforcement Console</h2>
        <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '24px' }}>
          Build targeted queries to clean up raid bots, malicious accounts, or perform general member sanitation. Matches are scanned across server caches.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {/* Join Timer */}
          <div>
            <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '6px', fontWeight: 500 }}>
              Joined within last X hours
            </label>
            <input
              type="number"
              className="input-field"
              placeholder="e.g. 2.5 (leaves blank for all time)"
              value={joinRangeHours}
              onChange={(e) => setJoinRangeHours(e.target.value)}
            />
          </div>

          {/* Regular Expression */}
          <div>
            <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '6px', fontWeight: 500 }}>
              Username RegExp Pattern
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. ^SpamBot_.*"
              value={usernameRegex}
              onChange={(e) => setUsernameRegex(e.target.value)}
            />
          </div>

          {/* Role Checkbox */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <label style={{ fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={hasNoRoles}
                onChange={(e) => setHasNoRoles(e.target.checked)}
                style={{ scale: '1.2', cursor: 'pointer' }}
              />
              Target members with NO roles
            </label>
          </div>
        </div>

        <button onClick={handleScan} className="btn btn-primary" style={{ padding: '12px 24px' }}>
          Scan Server Cache
        </button>
      </section>

      {/* 2. TARGET PREVIEW GRID */}
      {scanned && (
        <section className="glass-panel animate-fade-in" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Scan Target Results</h3>
              <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>
                Found <strong style={{ color: 'white' }}>{targets.length}</strong> matching members.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleTriggerAction('KICK')}
                className="btn btn-secondary"
                disabled={activeTargets.length === 0}
                style={{ borderColor: 'rgba(254, 231, 92, 0.4)', color: '#ffe45c', padding: '10px 18px' }}
              >
                ⚠️ Mass Kick ({activeTargets.length})
              </button>
              <button
                onClick={() => handleTriggerAction('BAN')}
                className="btn btn-danger"
                disabled={activeTargets.length === 0}
                style={{ padding: '10px 18px' }}
              >
                🔥 Mass Ban ({activeTargets.length})
              </button>
            </div>
          </div>

          {targets.length > 0 ? (
            <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid rgba(var(--border-glass))', borderRadius: '8px', background: 'rgba(0,0,0,0.15)' }}>
              <table className="custom-table" style={{ fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '80px', textAlign: 'center' }}>Target</th>
                    <th>Username</th>
                    <th>Account ID</th>
                    <th>Join Time</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => {
                    const isExcluded = excludedIds.includes(t.user.id);
                    return (
                      <tr key={t.user.id} style={{ opacity: isExcluded ? 0.35 : 1 }}>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ color: isExcluded ? '#ff8c8c' : '#57F287' }}>{isExcluded ? '❌ Ignore' : '🎯 Target'}</span>
                        </td>
                        <td style={{ fontWeight: 600, color: 'white' }}>{t.user.username}</td>
                        <td style={{ fontFamily: 'monospace' }}>{t.user.id}</td>
                        <td>{new Date(t.joined_at).toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => handleToggleExclude(t.user.id)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '10px', borderRadius: '4px' }}
                          >
                            {isExcluded ? 'Target' : 'Exclude'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--text-secondary))' }}>
              No members match the active query. Adjust your filters and scan again.
            </div>
          )}
        </section>
      )}

      {/* 3. SAFETY CONFIRMATION MODAL */}
      {showConfirmModal && actionType && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div className="glass-panel" style={{ width: '480px', padding: '30px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#ED4245' }}>
              ⚠️ High Risk Administrative Action
            </h3>
            
            <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '20px', lineHeight: '1.5' }}>
              You are about to execute a mass <strong style={{ color: 'white' }}>{actionType.toLowerCase()}</strong> on{' '}
              <strong style={{ color: 'white' }}>{activeTargets.length}</strong> matching accounts.
              This will submit sequential API requests to Discord and write permanent audit trails.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '24px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                  Log Reason
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Anti-raid action on spam user pattern"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#ED4245', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                  Type <span style={{ fontFamily: 'monospace' }}>CONFIRM MASS ACTION</span> to verify:
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Type verification text..."
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  style={{ borderColor: confirmInput === 'CONFIRM MASS ACTION' ? '#57F287' : 'rgba(var(--border-glass))' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowConfirmModal(false)} className="btn btn-secondary">
                Abort Action
              </button>
              <button
                onClick={handleExecuteEnforcement}
                className="btn btn-danger"
                disabled={confirmInput !== 'CONFIRM MASS ACTION'}
              >
                Execute Mass {actionType}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. EXECUTION QUEUE OVERLAY */}
      {executing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(9, 10, 15, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '3px solid rgba(88, 101, 242, 0.2)', borderTopColor: '#5865F2', animation: 'spin 1s linear infinite' }} />
          <h4 style={{ color: 'white', fontWeight: 600, fontSize: '18px' }}>Mass Enforcement Active</h4>
          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '13px' }}>{progressMsg}</p>
        </div>
      )}

    </div>
  );
}
