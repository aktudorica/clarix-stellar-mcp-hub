import { NavLink, Outlet, useNavigate } from 'react-router';
import {
  Activity,
  Plug,
  ArrowUpRight,
  Box,
  CircleHelp,
  Layers3,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { statusQuery, postJson } from '../lib/api';

import { useSession } from './auth';
import { Button } from './ui/button';
import { useState } from 'react';
export function Layout() {
  const session = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState('');
  async function logout() {
    try {
      await postJson('/api/auth/logout', {}, session.csrfToken);
      await client.cancelQueries();
      client.clear();
      navigate('/login');
    } catch {
      setLogoutError('Sign-out failed. Please retry.');
    }
  }
  const status = useQuery(statusQuery);
  const ready = status.data?.status === 'ready';
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          <img src="/favicon.svg" alt="" />
          <span>
            clarix<span className="brand-dot">.</span>
            <small>AGENT HUB</small>
          </span>
        </NavLink>
        <div className="workspace-label">
          <span className="workspace-avatar">{session.workspace.name[0]}</span>
          <div>
            {session.workspace.name}
            <small>Private workspace</small>
          </div>
          <Layers3 size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <Box size={18} /> Marketplace
          </NavLink>
          <NavLink to="/activity">
            <Activity size={18} /> Activity
          </NavLink>
          <NavLink to="/agent">
            <Sparkles size={18} /> AI assistant
          </NavLink>
          <NavLink to="/integrations">
            <Plug size={18} /> Integrations
          </NavLink>
          <NavLink to="/status">
            <Activity size={18} /> Platform status
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="build-note">
            <Sparkles size={18} />
            <strong>Built for what's next.</strong>
            <p>
              Stellar intelligence.
              <br />
              One connected ecosystem.
            </p>
            <span>INTERNAL PREVIEW</span>
          </div>
          <a
            className="docs-link"
            href="https://developers.stellar.org/docs/build/agentic-payments/x402"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={16} /> Stellar documentation <ArrowUpRight size={14} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Agent Hub</strong>
          </div>
          <div className="topbar-right">
            <span className="network-badge">
              <span /> Stellar Testnet
            </span>
            <span className="avatar" aria-label={session.user.name}>
              {session.user.name[0]}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                void logout();
              }}
            >
              Sign out
            </Button>
            {logoutError && <span role="alert">{logoutError}</span>}
          </div>
        </header>
        <main id="main-content">
          <Outlet />
        </main>
        <footer>
          <span>
            Clarix Agent Hub <span className="footer-separator">/</span> Testnet intelligence
          </span>
          <NavLink to="/status">
            <span className={`status-dot ${ready ? 'up' : 'down'}`} />
            {status.isPending
              ? 'Checking platform'
              : ready
                ? 'Platform connected'
                : 'Platform needs attention'}
            <ShieldCheck size={14} />
          </NavLink>
        </footer>
      </div>
    </div>
  );
}
