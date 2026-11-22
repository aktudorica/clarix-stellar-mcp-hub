import { lazy, Suspense } from 'react';
const AgentPage = lazy(() =>
  import('./pages/agent').then((module) => ({ default: module.AgentPage })),
);
const IntegrationsPage = lazy(() =>
  import('./pages/integrations').then((module) => ({ default: module.IntegrationsPage })),
);
import { Toaster } from 'sonner';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout';
import { Marketplace } from './pages/marketplace';
import { ServiceDetail } from './pages/service-detail';
import { StatusPage } from './pages/status';
import './styles.css';
import { RequireSession } from './components/auth';
import { Login } from './pages/login';
import { ActivityPage, ExecutionPage } from './pages/activity';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster richColors position="bottom-right" />
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route
            element={
              <RequireSession>
                <Layout />
              </RequireSession>
            }
          >
            <Route
              path="agent"
              element={
                <Suspense fallback={<p>Loading agent…</p>}>
                  <AgentPage />
                </Suspense>
              }
            />
            <Route
              path="integrations"
              element={
                <Suspense fallback={<p>Loading integrations…</p>}>
                  <IntegrationsPage />
                </Suspense>
              }
            />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="activity/:id" element={<ExecutionPage />} />
            <Route index element={<Marketplace />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="services/:slug" element={<ServiceDetail />} />
            <Route
              path="*"
              element={
                <div className="feedback">
                  <h1>Page not found</h1>
                  <Link to="/">Back to marketplace</Link>
                </div>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
