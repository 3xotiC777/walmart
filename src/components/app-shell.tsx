import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth';
import { LogoutIcon } from './icons';
import { AutoRefresh } from './auto-refresh';
import { WorkspaceRouteTransition } from './workspace-route-transition';
import { CurrentWorkspaceSection, WorkspaceNavigation } from './workspace-navigation';

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const leader = viewer.role === 'leader';

  return (
    <div className="workspace-shell">
      <AutoRefresh />
      <aside aria-label="Menú principal" className="side-rail">
        <Link aria-label="Ir al tablero" className="workspace-brand" href="/workspace" prefetch={false} transitionTypes={['workspace-tab']}><span>PQM</span><strong className="rail-label">Control<br/>Walmart</strong></Link>
        <WorkspaceNavigation leader={leader} />
        <form action="/api/auth/logout" method="post"><button aria-label="Salir" className="rail-logout" type="submit"><LogoutIcon /><span className="rail-label">Salir</span></button></form>
        <span aria-hidden="true" className="rail-reveal-hint">›</span>
      </aside>
      <section className="workspace-body">
        <header className="workspace-topbar">
          <CurrentWorkspaceSection leader={leader} workspaceName={viewer.workspaceName} />
          <div className="viewer-chip"><span>{viewer.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{viewer.displayName}</strong><small>{leader ? 'Líder' : 'Validador'}</small></div></div>
        </header>
        <main className="workspace-main"><WorkspaceRouteTransition>{children}</WorkspaceRouteTransition></main>
      </section>
    </div>
  );
}
