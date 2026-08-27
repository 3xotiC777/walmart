import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth';
import { LogoutIcon } from './icons';
import { AutoRefresh } from './auto-refresh';
import { CurrentWorkspaceSection, WorkspaceNavigation } from './workspace-navigation';

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const leader = viewer.role === 'leader';

  return (
    <div className="workspace-shell">
      <AutoRefresh />
      <aside className="side-rail">
        <Link className="workspace-brand" href="/workspace" prefetch={false}><span>PQM</span><strong>Control<br/>Walmart</strong></Link>
        <WorkspaceNavigation leader={leader} />
        <form action="/api/auth/logout" method="post"><button className="rail-logout" type="submit"><LogoutIcon />Salir</button></form>
      </aside>
      <section className="workspace-body">
        <header className="workspace-topbar">
          <CurrentWorkspaceSection leader={leader} workspaceName={viewer.workspaceName} />
          <div className="viewer-chip"><span>{viewer.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{viewer.displayName}</strong><small>{leader ? 'Líder' : 'Validador'}</small></div></div>
        </header>
        <main className="workspace-main">{children}</main>
      </section>
    </div>
  );
}
