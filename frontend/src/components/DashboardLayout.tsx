import React, { useState } from 'react';
import type { User, Guild } from '../App';

interface DashboardLayoutProps {
  guild: Guild;
  user: User;
  activeTab: 'overview' | 'members' | 'enforcement' | 'channels' | 'audit';
  setActiveTab: (tab: 'overview' | 'members' | 'enforcement' | 'channels' | 'audit') => void;
  onBackToServers: () => void;
  getGuildIcon: (guild: Guild, size?: number) => React.ReactNode;
  children: React.ReactNode;
}

export function DashboardLayout({
  guild,
  user,
  activeTab,
  setActiveTab,
  onBackToServers,
  getGuildIcon,
  children
}: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuItems = [
    {
      id: 'overview',
      label: 'Analytics & Overview',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      )
    },
    {
      id: 'members',
      label: 'Member Directory',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    },
    {
      id: 'enforcement',
      label: 'Enforcement Panel',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )
    },
    {
      id: 'channels',
      label: 'Channels & Roles',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="9" x2="20" y2="9" />
          <line x1="4" y1="15" x2="20" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      )
    },
    {
      id: 'audit',
      label: 'Action Logs',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', position: 'relative' }}>
      
      {/* MOBILE HEADER BUTTON */}
      <div
        className="glass-panel"
        style={{
          position: 'fixed',
          top: '12px',
          left: '12px',
          zIndex: 999,
          padding: '8px',
          display: 'none',
          cursor: 'pointer'
        }}
        onClick={() => setMobileOpen(!mobileOpen)}
        id="mobile-toggle-btn"
      >
        Menu
      </div>

      {/* SIDEBAR SIDE PANEL */}
      <aside
        style={{
          width: 'var(--sidebar-width)',
          height: 'calc(100vh - 24px)',
          position: 'sticky',
          top: '12px',
          marginLeft: '12px',
          marginRight: '12px',
          marginTop: '12px',
          marginBottom: '12px',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100,
          borderRadius: '16px',
          borderRight: '1px solid rgba(var(--border-glass))'
        }}
        className={`glass-panel sidebar ${mobileOpen ? 'open' : ''}`}
      >
        {/* Guild Profile Section */}
        <div
          style={{
            padding: '24px 20px',
            borderBottom: '1px solid rgba(var(--border-glass))',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          {getGuildIcon(guild, 36)}
          <div style={{ minWidth: 0 }}>
            <h4
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: 'white',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {guild.name}
            </h4>
            <div style={{ fontSize: '11px', color: '#57F287', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#57F287', display: 'inline-block' }} />
              Console Active
            </div>
          </div>
        </div>

        {/* Sidebar Nav Items */}
        <nav style={{ padding: '20px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {menuItems.map((item) => {
            const isSelected = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as any);
                  setMobileOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background: isSelected ? 'hsl(var(--primary))' : 'transparent',
                  color: isSelected ? 'white' : 'hsl(var(--text-secondary))',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                  transition: 'all 0.2s ease-in-out'
                }}
                className="sidebar-link"
              >
                <span style={{ display: 'inline-flex', opacity: isSelected ? 1 : 0.7 }}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User profile details at the bottom of the sidebar */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(var(--border-glass))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(0,0,0,0.15)',
            borderBottomLeftRadius: '16px',
            borderBottomRightRadius: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '13px'
              }}
            >
              👤
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100px'
                }}
              >
                {user.username}
              </div>
              <div style={{ fontSize: '10px', color: 'hsl(var(--text-secondary))' }}>Console Operator</div>
            </div>
          </div>

          <button
            onClick={onBackToServers}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'hsl(var(--text-secondary))',
              display: 'flex',
              padding: '6px',
              borderRadius: '6px',
              transition: 'background-color 0.2s'
            }}
            title="Return to server select"
            className="sidebar-logout-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      {/* PRIMARY WORKSPACE */}
      <main
        style={{
          flex: 1,
          padding: '24px 24px 40px 12px',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '24px'
        }}
        id="main-workspace"
      >
        {children}
      </main>

      {/* Inline styles for responsive layout toggles */}
      <style>{`
        @media (max-width: 768px) {
          #mobile-toggle-btn {
            display: block !important;
          }
          .sidebar {
            position: fixed !important;
            left: -300px !important;
            height: calc(100vh - 24px) !important;
            transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            margin-right: 0 !important;
          }
          .sidebar.open {
            left: 12px !important;
          }
          #main-workspace {
            padding: 70px 16px 30px 16px !important;
          }
        }
        .sidebar-link:hover {
          background: rgba(255,255,255,0.05);
          color: white;
        }
        .sidebar-logout-btn:hover {
          background: rgba(237, 66, 69, 0.12);
          color: hsl(var(--danger));
        }
      `}</style>
    </div>
  );
}
