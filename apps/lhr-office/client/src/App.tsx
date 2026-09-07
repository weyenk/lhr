import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/auth';
import { Login } from './pages/Login';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { panels } from './panels';

export function App() {
  const { session, loading } = useSession();

  if (loading) return <div className="app-loading">Loading…</div>;
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
