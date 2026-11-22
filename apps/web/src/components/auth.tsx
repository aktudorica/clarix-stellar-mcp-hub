import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router';
import type { SessionView } from '@clarix/contracts';
import { sessionQuery } from '../lib/api';
import { ErrorState, LoadingState } from './feedback';
const SessionContext = createContext<SessionView | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Session provider is missing');
  return session;
}
export function RequireSession({ children }: { children: ReactNode }) {
  const query = useQuery(sessionQuery);
  const location = useLocation();
  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return (
      <ErrorState
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (!query.data) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <SessionContext.Provider value={query.data}>{children}</SessionContext.Provider>;
}
