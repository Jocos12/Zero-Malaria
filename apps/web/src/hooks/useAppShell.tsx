import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { WebShell } from '../components/shells';

/** True for /app/* (all product routes after web-only unification). */
export function useIsAppRoute(): boolean {
  const { pathname } = useLocation();
  return pathname.startsWith('/app') || !pathname.startsWith('/m');
}

/** Single web shell for every role and route. */
export function AppOrChwShell({
  title,
  crumbs,
  children,
}: {
  title: string;
  crumbs?: string[];
  children: ReactNode;
}) {
  return (
    <WebShell title={title} crumbs={crumbs || [title]}>
      {children}
    </WebShell>
  );
}
