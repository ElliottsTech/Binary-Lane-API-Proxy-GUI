import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, post } from './api.js';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';
import Users from './pages/Users.jsx';
import UserDetail from './pages/UserDetail.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  const [me, setMe] = useState(null);          // null = loading, false = logged out
  const [bootstrapped, setBootstrapped] = useState(null);
  const navigate = useNavigate();

  async function refresh() {
    try {
      setMe(await api('/me'));
    } catch {
      setMe(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    api('/bootstrap/status').then(s => setBootstrapped(s.bootstrapped)).catch(() => {});
  }, []);

  if (me === null) return <div className="centered">Loading…</div>;

  // not bootstrapped -> setup flow
  if (bootstrapped === false) {
    return <Routes><Route path="*" element={<Setup onDone={refresh} />} /></Routes>;
  }

  // not logged in -> login
  if (!me) {
    return <Routes><Route path="*" element={<Login onDone={refresh} />} /></Routes>;
  }

  async function doLogout() {
    await post('/logout');
    setMe(false);
    navigate('/');
  }

  return (
    <div className="layout">
      <nav className="navbar">
        <span className="brand">BL Proxy Admin</span>
        <NavLink to="/users">Users</NavLink>
        {me.isAdmin && <NavLink to="/audit">Audit Log</NavLink>}
        <span className="spacer" />
        <span className="who">{me.username}</span>
        <button onClick={doLogout} className="btn-link">Log out</button>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/users" />} />
          <Route path="/users" element={<Users me={me} />} />
          <Route path="/users/:username" element={<UserDetail me={me} />} />
          {me.isAdmin && <Route path="/audit" element={<AuditLog />} />}
          <Route path="*" element={<Navigate to="/users" />} />
        </Routes>
      </main>
    </div>
  );
}
