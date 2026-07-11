import { useEffect, useState } from 'react';
import { api } from './api';
import LoginPage from './LoginPage';
import Dashboard from './Dashboard';
import ClientsPage from './ClientsPage';
import ClientDetailPage from './ClientDetailPage';
import ProposalsPage from './ProposalsPage';
import DailyBriefPage from './DailyBriefPage';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const hash = useHashRoute();

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
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const clientMatch = hash.match(/^#\/clients\/(.+)$/);
  let page: React.ReactNode;
  if (clientMatch) {
    page = <ClientDetailPage orgId={decodeURIComponent(clientMatch[1] ?? '')} />;
  } else if (hash.startsWith('#/clients')) {
    page = <ClientsPage />;
  } else if (hash.startsWith('#/proposals')) {
    page = <ProposalsPage />;
  } else if (hash.startsWith('#/brief')) {
    page = <DailyBriefPage />;
  } else {
    page = <Dashboard />;
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
  }

  const navCls = (active: boolean) =>
    active ? 'font-semibold text-blue-700' : 'text-slate-600 hover:text-slate-900';

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-bold text-slate-900">نظام هورايزن إكس</h1>
            <nav className="flex gap-4 text-sm">
              <a
                href="#/"
                className={navCls(!hash.startsWith('#/clients') && !hash.startsWith('#/proposals') && !hash.startsWith('#/brief'))}
              >
                لوحة المؤشرات
              </a>
              <a href="#/brief" className={navCls(hash.startsWith('#/brief'))}>
                الملخص الصباحي
              </a>
              <a href="#/proposals" className={navCls(hash.startsWith('#/proposals'))}>
                صندوق الموافقات
              </a>
              <a href="#/clients" className={navCls(hash.startsWith('#/clients'))}>
                العملاء
              </a>
            </nav>
          </div>
          <button onClick={() => void logout()} className="text-sm text-slate-500 hover:text-slate-800">
            تسجيل الخروج
          </button>
        </div>
      </header>
      {page}
    </main>
  );
}
