import { useState, useEffect } from 'react';

interface Channel {
  id: string;
  name: string;
  type: number; // 0: Text, 2: Voice, 4: Category
  position: number;
  parent_id: string | null;
}

interface Role {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  member_count?: number;
}

export function ChannelsRolesView({ guildId }: { guildId: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Channel Creation State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<number>(0); // Default: Text
  const [newChannelParent, setNewChannelParent] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [guildId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [channelsRes, rolesRes] = await Promise.all([
        fetch(`/api/guilds/${guildId}/channels`),
        fetch(`/api/guilds/${guildId}/roles`)
      ]);

      if (channelsRes.ok) setChannels(await channelsRes.json());
      if (rolesRes.ok) setRoles(await rolesRes.json());
    } catch (err) {
      console.error('Failed to load channels and roles:', err);
    } finally {
      setLoading(false);
    }
  };

  // Create Channel Action
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;

    try {
      setSubmitting(true);
      // Format name: lowercase and hyphens for text channels
      let formattedName = newChannelName.trim();
      if (newChannelType === 0) {
        formattedName = formattedName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
      }

      const response = await fetch(`/api/guilds/${guildId}/actions/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formattedName,
          type: newChannelType,
          parentId: newChannelType !== 4 && newChannelParent ? newChannelParent : null
        })
      });

      if (response.ok) {
        setNewChannelName('');
        setNewChannelParent('');
        setShowCreateModal(false);
        await fetchData(); // Reload list
      } else {
        const err = await response.json();
        alert(err.error || 'Failed to create channel.');
      }
    } catch (err) {
      console.error(err);
      alert('Network request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Channel Action
  const handleDeleteChannel = async (channelId: string, name: string) => {
    const confirm = window.confirm(`Are you sure you want to permanently delete the channel #${name}?`);
    if (!confirm) return;

    try {
      setSubmitting(true);
      const response = await fetch(`/api/guilds/${guildId}/actions/channels/${channelId}?name=${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchData();
      } else {
        const err = await response.json();
        alert(err.error || 'Failed to delete channel.');
      }
    } catch (err) {
      console.error(err);
      alert('Network request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Group channels by category
  const categories = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const uncategorizedText = channels.filter((c) => c.type === 0 && !c.parent_id).sort((a, b) => a.position - b.position);
  const uncategorizedVoice = channels.filter((c) => c.type === 2 && !c.parent_id).sort((a, b) => a.position - b.position);

  const getChannelsInCategory = (catId: string, type: number) => {
    return channels
      .filter((c) => c.type === type && c.parent_id === catId)
      .sort((a, b) => a.position - b.position);
  };

  const getRoleColor = (color: number) => {
    return color === 0 ? '#b9bbbe' : `#${color.toString(16).padStart(6, '0')}`;
  };

  const getRolePermissionsSummary = (permsStr: string) => {
    try {
      const perms = BigInt(permsStr);
      const list = [];
      if ((perms & (1n << 3n)) === (1n << 3n)) list.push('Administrator');
      if ((perms & (1n << 5n)) === (1n << 5n)) list.push('Manage Server');
      if ((perms & (1n << 28n)) === (1n << 28n)) list.push('Manage Roles');
      if ((perms & (1n << 2n)) === (1n << 2n)) list.push('Ban');
      if ((perms & (1n << 1n)) === (1n << 1n)) list.push('Kick');
      
      if (list.length === 0) return 'General Permissions';
      return list.join(', ');
    } catch {
      return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', width: '100%' }}>
        <div className="glass-card skeleton" style={{ height: '400px', borderRadius: '16px' }} />
        <div className="glass-card skeleton" style={{ height: '400px', borderRadius: '16px' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', width: '100%' }} className="animate-fade-in">
      
      {/* COLUMN 1: SERVER ROLES HIERARCHY */}
      <section className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Role Hierarchy</h2>
          <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>
            Sorted in descending priority stack. Key permission gates are listed.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto', paddingRight: '4px' }}>
          {roles.map((role) => {
            const hexColor = getRoleColor(role.color);
            const isEveryone = role.name === '@everyone';
            return (
              <div
                key={role.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(var(--border-glass))',
                  borderRadius: '8px',
                  borderLeft: `4px solid ${hexColor}`
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'white', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {role.name}
                    {!isEveryone && <span style={{ fontSize: '11px', color: 'hsl(var(--text-secondary))' }}>Pos: {role.position}</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'hsl(var(--text-dark))', marginTop: '2px' }}>
                    {getRolePermissionsSummary(role.permissions)}
                  </div>
                </div>

                <div className="badge badge-success" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {role.member_count !== undefined ? `${role.member_count} Members` : 'N/A'}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* COLUMN 2: CHANNEL DIRECTORY CATEGORIES */}
      <section className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Channel Categories</h2>
            <p style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>
              Create, delete, and inspect channels in real-time.
            </p>
          </div>
          
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="btn btn-primary" 
            style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '6px' }}
          >
            ➕ Create Channel
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '500px', overflowY: 'auto', paddingRight: '4px' }}>
          
          {/* A. Uncategorized Channels */}
          {(uncategorizedText.length > 0 || uncategorizedVoice.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--text-dark))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Uncategorized
              </span>
              
              {uncategorizedText.map((ch) => (
                <div key={ch.id} className="channel-item-row" style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: 'hsl(var(--text-secondary))', paddingLeft: '8px', height: '28px' }}>
                  <span style={{ marginRight: '8px' }}>#️⃣</span>
                  {ch.name}
                  <button onClick={() => handleDeleteChannel(ch.id, ch.name)} className="channel-delete-btn">🗑️</button>
                </div>
              ))}
              
              {uncategorizedVoice.map((ch) => (
                <div key={ch.id} className="channel-item-row" style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color: 'hsl(var(--text-secondary))', paddingLeft: '8px', height: '28px' }}>
                  <span style={{ marginRight: '8px' }}>🔊</span>
                  {ch.name}
                  <button onClick={() => handleDeleteChannel(ch.id, ch.name)} className="channel-delete-btn">🗑️</button>
                </div>
              ))}
            </div>
          )}

          {/* B. Sorted Categories */}
          {categories.map((cat) => {
            const textChannels = getChannelsInCategory(cat.id, 0);
            const voiceChannels = getChannelsInCategory(cat.id, 2);
            
            return (
              <div key={cat.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {/* Category Header */}
                <div 
                  className="channel-item-row"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'hsl(var(--text-secondary))',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    display: 'flex',
                    alignItems: 'center',
                    height: '28px'
                  }}
                >
                  <span style={{ marginRight: '4px' }}>▼</span> {cat.name}
                  <button onClick={() => handleDeleteChannel(cat.id, cat.name)} className="channel-delete-btn">🗑️</button>
                </div>

                {/* Text channels in category */}
                {textChannels.map((ch) => (
                  <div
                    key={ch.id}
                    className="channel-item-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: '14px',
                      color: 'hsl(var(--text-secondary))',
                      paddingLeft: '14px',
                      height: '28px'
                    }}
                  >
                    <span style={{ opacity: 0.6, marginRight: '8px' }}>#️⃣</span>
                    {ch.name}
                    <button onClick={() => handleDeleteChannel(ch.id, ch.name)} className="channel-delete-btn">🗑️</button>
                  </div>
                ))}

                {/* Voice channels in category */}
                {voiceChannels.map((ch) => (
                  <div
                    key={ch.id}
                    className="channel-item-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: '14px',
                      color: 'hsl(var(--text-secondary))',
                      paddingLeft: '14px',
                      height: '28px'
                    }}
                  >
                    <span style={{ opacity: 0.6, marginRight: '8px' }}>🔊</span>
                    {ch.name}
                    <button onClick={() => handleDeleteChannel(ch.id, ch.name)} className="channel-delete-btn">🗑️</button>
                  </div>
                ))}

                {textChannels.length === 0 && voiceChannels.length === 0 && (
                  <span style={{ fontSize: '12px', color: 'hsl(var(--text-dark))', paddingLeft: '14px', fontStyle: 'italic', height: '24px', display: 'flex', alignItems: 'center' }}>
                    Empty Category
                  </span>
                )}
              </div>
            );
          })}

        </div>
      </section>

      {/* 3. CREATE CHANNEL MODAL */}
      {showCreateModal && (
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
          <form onSubmit={handleCreateChannel} className="glass-panel animate-fade-in" style={{ width: '420px', padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Create New Channel</h3>

            {/* Type selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Channel Type</label>
              <select 
                className="input-field" 
                value={newChannelType} 
                onChange={(e) => setNewChannelType(parseInt(e.target.value))}
                style={{ cursor: 'pointer' }}
              >
                <option value={0}>#️⃣ Text Channel</option>
                <option value={2}>🔊 Voice Channel</option>
                <option value={4}>📁 Category</option>
              </select>
            </div>

            {/* Name Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Channel Name</label>
              <input
                type="text"
                className="input-field"
                placeholder={newChannelType === 4 ? 'e.g. Server Logs' : 'e.g. general-chat'}
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                maxLength={100}
                required
              />
            </div>

            {/* Category selector (only if not creating a category itself) */}
            {newChannelType !== 4 && categories.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>Category Parent</label>
                <select 
                  className="input-field" 
                  value={newChannelParent} 
                  onChange={(e) => setNewChannelParent(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">No Category (Uncategorized)</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Modal Controls */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button 
                type="button" 
                onClick={() => { setShowCreateModal(false); setNewChannelName(''); }} 
                className="btn btn-secondary"
                disabled={submitting}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={submitting || !newChannelName.trim()}
              >
                {submitting ? 'Creating...' : 'Create Channel'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Styled tags for channel hover delete trigger */}
      <style>{`
        .channel-item-row {
          width: 100%;
          position: relative;
          display: flex;
          align-items: center;
          border-radius: 6px;
          padding-right: 8px;
          transition: background-color 0.2s ease;
        }
        .channel-item-row:hover {
          background-color: rgba(255, 255, 255, 0.03);
        }
        .channel-delete-btn {
          margin-left: auto;
          background: transparent;
          border: none;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s ease, transform 0.1s ease;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .channel-delete-btn:hover {
          transform: scale(1.2);
          background-color: rgba(237, 66, 69, 0.15);
        }
        .channel-item-row:hover .channel-delete-btn {
          opacity: 1;
        }
      `}</style>

    </div>
  );
}
