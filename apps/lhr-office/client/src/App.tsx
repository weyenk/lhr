import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/auth';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { panels } from './panels';
import { getAuthFlowTypeFromHash, type AuthFlowType } from './lib/authFlow';

export function App() {
  const { session, loading } = useSession();
  const [authFlowType, setAuthFlowType] = useState<AuthFlowType | null>(() =>
    getAuthFlowTypeFromHash(window.location.hash),
  );

  if (loading) return <div className="app-loading">Loading…</div>;
  if (authFlowType && session) return <SetPassword onDone={() => setAuthFlowType(null)} />;
  if (!session) return <Login />;

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
