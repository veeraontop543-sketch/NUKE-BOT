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
  communication_disabled_until?: string | null;
}

interface Role {
  id: string;
  name: string;
  color: number;
}

export function MemberDirectoryView({ guildId }: { guildId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  
  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Modals & Action States
  const [actionUser, setActionUser] = useState<Member | null>(null);
  const [actionType, setActionType] = useState<'KICK' | 'BAN' | 'TIMEOUT' | 'ROLE_ADD' | 'ROLE_REMOVE' | null>(null);
  const [reason, setReason] = useState('');
  const [executing, setExecuting] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  useEffect(() => {
    fetchData();
  }, [guildId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch roles and members concurrently
      const [rolesRes, membersRes] = await Promise.all([
        fetch(`/api/guilds/${guildId}/roles`),
        fetch(`/api/guilds/${guildId}/members?limit=100`)
      ]);

      if (rolesRes.ok) setRoles(await rolesRes.json());
      if (membersRes.ok) {
        const memData = await membersRes.json();
        setMembers(memData.members || []);
      }
    } catch (err) {
      console.error('Failed to load member data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Perform single moderation action
  const handleSingleAction = async () => {
    if (!actionUser || !actionType) return;
    try {
      setExecuting(true);
      setProgressMsg(`Executing ${actionType}...`);
      
      const payload: any = {
        userId: actionUser.user.id,
        userTag: `${actionUser.user.username}#${actionUser.user.discriminator}`,
        reason
      };

      let endpoint = '';
      if (actionType === 'KICK') {
        endpoint = `/api/guilds/${guildId}/actions/kick`;
      } else if (actionType === 'BAN') {
        endpoint = `/api/guilds/${guildId}/actions/ban`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        // Refresh directory
        await fetchData();
        closeModal();
      } else {
        const errData = await response.json();
        alert(errData.error || `Failed to execute ${actionType}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network request failed.');
    } finally {
      setExecuting(false);
    }
  };

  // Execute bulk operation
  const handleBulkAction = async (type: 'BULK_KICK' | 'BULK_BAN' | 'BULK_ROLE_ADD' | 'BULK_ROLE_REMOVE') => {
    if (selectedIds.length === 0) return;
    
    const actionName = type.replace('BULK_', '');
    const confirmPrompt = `Are you sure you want to ${actionName.toLowerCase()} ${selectedIds.length} members?`;
    if (!window.confirm(confirmPrompt)) return;

    const actionReason = window.prompt(`Enter reason for bulk ${actionName.toLowerCase()}:`, `Bulk dashboard execution`);
    if (actionReason === null) return; // cancelled

    try {
      setExecuting(true);
      setProgressMsg(`Processing bulk operation on ${selectedIds.length} accounts. Please wait...`);

      let endpoint = '';
      let payload: any = {
        userIds: selectedIds,
        reason: actionReason
      };

      if (type === 'BULK_KICK') {
        endpoint = `/api/guilds/${guildId}/actions/mass-kick`;
      } else if (type === 'BULK_BAN') {
        endpoint = `/api/guilds/${guildId}/actions/mass-ban`;
      } else if (type === 'BULK_ROLE_ADD' || type === 'BULK_ROLE_REMOVE') {
        const rId = window.prompt('Enter Role ID to apply:');
        if (!rId) return;
        endpoint = `/api/guilds/${guildId}/actions/bulk-roles`;
        payload.roleId = rId;
        payload.mode = type === 'BULK_ROLE_ADD' ? 'ADD' : 'REMOVE';
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully processed. Succeeded: ${result.summary.succeeded}, Failed: ${result.summary.failed}`);
        setSelectedIds([]);
        await fetchData();
      } else {
        const errData = await response.json();
        alert(errData.error || 'Failed to process bulk actions.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setExecuting(false);
    }
  };

  const closeModal = () => {
    setActionUser(null);
    setActionType(null);
    setReason('');
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredMembers.map((m) => m.user.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((sid) => sid !== id));
    }
  };

  // Filter lists on client
  const filteredMembers = members.filter((member) => {
    const nameMatch =
      member.user.username.toLowerCase().includes(search.toLowerCase()) ||
      (member.nick && member.nick.toLowerCase().includes(search.toLowerCase())) ||
      member.user.id.includes(search);
      
    const roleMatch = selectedRole ? member.roles.includes(selectedRole) : true;
    return nameMatch && roleMatch;
  });

  const getRoleBadge = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return null;
    const colorHex = role.color === 0 ? '#99aab5' : `#${role.color.toString(16).padStart(6, '0')}`;
    return (
      <span
        key={role.id}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: `${colorHex}15`,
          color: colorHex,
          border: `1px solid ${colorHex}30`,
          marginRight: '4px',
          marginTop: '4px',
          fontWeight: 500
        }}
      >
        {role.name}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="glass-panel skeleton" style={{ width: '100%', height: '450px', borderRadius: '16px' }} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', position: 'relative' }} className="animate-fade-in">
      
      {/* 1. FILTERING BOARD */}
      <section className="glass-panel" style={{ padding: '18px 24px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Member Directory</h2>

        <div style={{ display: 'flex', gap: '12px', flex: 1, justifySelf: 'flex-end', maxWidth: '600px' }}>
          {/* Search Field */}
          <input
            type="text"
            className="input-field"
            placeholder="Search username, nickname, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 2 }}
          />

          {/* Role Filter Selector */}
          <select
            className="input-field"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            style={{ flex: 1, minWidth: '150px', cursor: 'pointer' }}
          >
            <option value="">All Roles</option>
            {roles
              .filter((r) => r.name !== '@everyone')
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
          </select>
        </div>
      </section>

      {/* 2. MEMBERS DIRECTORY TABLE */}
      <section className="glass-panel" style={{ padding: '0px', overflow: 'hidden' }}>
        <div className="custom-table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: '50px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filteredMembers.length > 0 && selectedIds.length === filteredMembers.length}
                    onChange={handleSelectAll}
                    style={{ cursor: 'pointer', scale: '1.2' }}
                  />
                </th>
                <th>Member Profile</th>
                <th>Account ID</th>
                <th>Join Date</th>
                <th>Roles</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => (
                <tr key={member.user.id} style={{ opacity: member.communication_disabled_until ? 0.6 : 1 }}>
                  
                  {/* Checkbox selector */}
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(member.user.id)}
                      onChange={(e) => handleSelectOne(member.user.id, e.target.checked)}
                      style={{ cursor: 'pointer', scale: '1.2' }}
                    />
                  </td>

                  {/* Profile columns */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          backgroundColor: '#2f3136',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '12px',
                          overflow: 'hidden'
                        }}
                      >
                        {member.user.avatar ? (
                          <img
                            src={`https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`}
                            alt=""
                            style={{ width: '100%', height: '100%' }}
                          />
                        ) : (
                          member.user.username[0].toUpperCase()
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'white' }}>
                          {member.user.username}
                          {member.user.discriminator !== '0' && <span style={{ color: 'hsl(var(--text-dark))', fontSize: '11px' }}>#{member.user.discriminator}</span>}
                        </div>
                        {member.nick && <div style={{ fontSize: '11px', color: 'hsl(var(--text-secondary))' }}>Nick: {member.nick}</div>}
                      </div>
                    </div>
                  </td>

                  {/* ID column */}
                  <td style={{ fontSize: '12px', fontFamily: 'monospace', color: 'hsl(var(--text-secondary))' }}>
                    {member.user.id}
                  </td>

                  {/* Join Date column */}
                  <td style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))' }}>
                    {new Date(member.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>

                  {/* Roles badges */}
                  <td style={{ maxWidth: '280px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                      {member.roles.length > 0 ? (
                        member.roles.map((rid) => getRoleBadge(rid))
                      ) : (
                        <span style={{ fontSize: '11px', color: 'hsl(var(--text-dark))' }}>No roles assigned</span>
                      )}
                    </div>
                  </td>

                  {/* Single Actions */}
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        onClick={() => { setActionUser(member); setActionType('KICK'); }}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '4px' }}
                      >
                        Kick
                      </button>
                      <button
                        onClick={() => { setActionUser(member); setActionType('BAN'); }}
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '4px' }}
                      >
                        Ban
                      </button>
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. FLOATING BULK ACTIONS BAR (Appears dynamically if > 0 checked) */}
      {selectedIds.length > 0 && (
        <div
          className="glass-panel"
          style={{
            position: 'fixed',
            bottom: '24px',
            left: 'calc(var(--sidebar-width) + 36px)',
            right: '24px',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'between',
            zIndex: 900,
            borderRadius: '12px',
            border: '1px solid rgba(88, 101, 242, 0.4)',
            boxShadow: '0 8px 32px 0 rgba(88, 101, 242, 0.15)',
            animation: 'fadeInUp 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          id="bulk-floating-bar"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: 'hsl(var(--primary))',
                color: 'white',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '11px'
              }}
            >
              {selectedIds.length}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Members selected</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              onClick={() => handleBulkAction('BULK_ROLE_ADD')}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '6px' }}
            >
              ➕ Assign Role
            </button>
            <button
              onClick={() => handleBulkAction('BULK_ROLE_REMOVE')}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '6px' }}
            >
              ➖ Remove Role
            </button>
            <button
              onClick={() => handleBulkAction('BULK_KICK')}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '6px', color: '#ff8c8c' }}
            >
              ⚠️ Mass Kick
            </button>
            <button
              onClick={() => handleBulkAction('BULK_BAN')}
              className="btn btn-danger"
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '6px' }}
            >
              🔥 Mass Ban
            </button>
          </div>
        </div>
      )}

      {/* 4. MODERATION POPUPS (KICK/BAN/TIMEOUT MODAL) */}
      {actionUser && actionType && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div className="glass-panel" style={{ width: '450px', padding: '30px', position: 'relative' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
              Confirm {actionType === 'KICK' ? 'Member Kick' : 'Member Ban'}
            </h3>
            
            <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '20px' }}>
              You are about to execute a {actionType.toLowerCase()} on user{' '}
              <strong style={{ color: 'white' }}>{actionUser.user.username}</strong> ({actionUser.user.id}). This action will be executed in real-time and recorded in the server logs.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '24px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', display: 'block', marginBottom: '6px', fontWeight: 500 }}>
                  Reason for {actionType.toLowerCase()}
                </label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Provide an administrative reason..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ resize: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={closeModal} className="btn btn-secondary" disabled={executing}>
                Cancel
              </button>
              <button onClick={handleSingleAction} className="btn btn-danger" disabled={executing}>
                Confirm & Execute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. LOADING / BATCH EXECUTION SCREEN */}
      {executing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(9, 10, 15, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '3px solid rgba(88, 101, 242, 0.2)', borderTopColor: '#5865F2', animation: 'spin 1s linear infinite' }} />
          <h4 style={{ color: 'white', fontWeight: 600 }}>Administrative Enforcement in Progress</h4>
          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '13px' }}>{progressMsg}</p>
        </div>
      )}

      {/* Styles to fix sticky layouts on mobile */}
      <style>{`
        @media (max-width: 768px) {
          #bulk-floating-bar {
            left: 16px !important;
            right: 16px !important;
            bottom: 16px !important;
            flex-direction: column !important;
            gap: 12px !important;
            align-items: flex-start !important;
          }
          #bulk-floating-bar div {
            width: 100% !important;
            justify-content: flex-end !important;
          }
        }
      `}</style>
    </div>
  );
}
