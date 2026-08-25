import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth';
import { FileIcon, GridIcon, LogoutIcon, TasksIcon, UploadCloudIcon, UsersIcon } from './icons';
import { AutoRefresh } from './auto-refresh';

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const leader = viewer.role === 'leader';
  const links = leader
    ? [
      { href: '/workspace', label: 'Tablero', icon: GridIcon },
      { href: '/workspace/cargas/nueva', label: 'Nueva jornada', icon: UploadCloudIcon },
      { href: '/workspace/tareas', label: 'Revisión', icon: TasksIcon },
      { href: '/workspace/equipo', label: 'Equipo', icon: UsersIcon },
      { href: '/workspace/exportar', label: 'Descargas', icon: FileIcon },
    ]
    : [
      { href: '/workspace', label: 'Mi resumen', icon: GridIcon },
      { href: '/workspace/tareas', label: 'Mis tareas', icon: TasksIcon },
    ];

  return (
    <div className="workspace-shell">
      <AutoRefresh />
      <aside className="side-rail">
        <Link className="workspace-brand" href="/workspace" prefetch={false}><span>PQM</span><strong>Control<br/>Walmart</strong></Link>
        <nav aria-label="Navegación principal">
          {links.map(({ href, label, icon: Icon }) => <Link href={href} key={href} prefetch={false}><Icon />{label}</Link>)}
        </nav>
        <form action="/api/auth/logout" method="post"><button className="rail-logout" type="submit"><LogoutIcon />Salir</button></form>
      </aside>
      <section className="workspace-body">
        <header className="workspace-topbar">
          <div><small>{viewer.workspaceName}</small><strong>{leader ? 'Mesa de control' : 'Bandeja de validación'}</strong></div>
          <div className="viewer-chip"><span>{viewer.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{viewer.displayName}</strong><small>{leader ? 'Líder' : 'Validador'}</small></div></div>
        </header>
        <main className="workspace-main">{children}</main>
      </section>
    </div>
  );
}
