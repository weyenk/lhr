import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/auth';
import { supabase } from './lib/supabaseClient';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { panels } from './panels';
import {
  getAuthFlowTypeFromHash,
  getAuthErrorFromHash,
  getAuthTokensFromHash,
  getInitialAuthHash,
  type AuthFlowType,
} from './lib/authFlow';

export function App() {
  const { session, loading } = useSession();
  const [initialHash] = useState<string>(getInitialAuthHash);
  const [authFlowType, setAuthFlowType] = useState<AuthFlowType | null>(() => getAuthFlowTypeFromHash(initialHash));
  const [authError] = useState<string | null>(() => getAuthErrorFromHash(initialHash));
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authFlowType) return;
    const tokens = getAuthTokensFromHash(initialHash);
    if (!tokens) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    supabase.auth.setSession(tokens).then(({ error }) => {
      if (error) setSessionError(error.message);
    });
  }, [authFlowType, initialHash]);

  if (loading) return <div className="app-loading">Loading…</div>;
  if (authFlowType && session) return <SetPassword onDone={() => setAuthFlowType(null)} />;
  if (!session) return <Login initialError={authError ?? sessionError} />;

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <ErrorBoundary>
            <Routes>
              {panels.map((panel) => (
                <Route key={panel.id} path={panel.path} element={<panel.component />} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
