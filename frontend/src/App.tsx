import { useEffect, useState } from 'react';
import { api } from './api';
import LoginPage from './LoginPage';
import Dashboard from './Dashboard';

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ authed: boolean }>('/api/auth/me')
      .then((r) => setAuthed(r.authed))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">جارٍ التحميل…</p>
      </main>
    );
  }
  return authed ? <Dashboard onLogout={() => setAuthed(false)} /> : <LoginPage onLogin={() => setAuthed(true)} />;
}
