'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { ViewTransition } from 'react';
import {
  FileIcon,
  GridIcon,
  MediaIcon,
  TasksIcon,
  UploadCloudIcon,
  UsersIcon,
} from './icons';

const LEADER_LINKS = [
  { href: '/workspace', label: 'Tablero', icon: GridIcon },
  { href: '/workspace/cargas/nueva', label: 'Nueva jornada', icon: UploadCloudIcon },
  { href: '/workspace/tareas', label: 'Revisión', icon: TasksIcon },
  { href: '/workspace/multimedia', label: 'Multimedia', icon: MediaIcon },
  { href: '/workspace/equipo', label: 'Equipo', icon: UsersIcon },
  { href: '/workspace/historia', label: 'Historia', icon: FileIcon },
  { href: '/workspace/exportar', label: 'Descargas', icon: FileIcon },
] as const;

const VALIDATOR_LINKS = [
  { href: '/workspace', label: 'Mi resumen', icon: GridIcon },
  { href: '/workspace/tareas', label: 'Mis tareas', icon: TasksIcon },
  { href: '/workspace/multimedia', label: 'Multimedia', icon: MediaIcon },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/workspace') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationActivity() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`nav-activity ${pending ? 'is-pending' : ''}`} />;
}

export function WorkspaceNavigation({ leader }: { leader: boolean }) {
  const pathname = usePathname();
  const links = leader ? LEADER_LINKS : VALIDATOR_LINKS;

  return (
    <nav aria-label="Navegación principal">
      {links.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            className={active ? 'is-active' : ''}
            href={href}
            key={href}
            prefetch={false}
            transitionTypes={['workspace-tab']}
          >
            {active && (
              <ViewTransition default="none" name="workspace-active-navigation" share="workspace-nav-marker">
                <span aria-hidden="true" className="nav-active-surface" />
              </ViewTransition>
            )}
            <span className="nav-link-content"><Icon /><span className="rail-label">{label}</span></span>
            <span aria-hidden="true" className="nav-tooltip">{label}</span>
            <NavigationActivity />
          </Link>
        );
      })}
    </nav>
  );
}

export function CurrentWorkspaceSection({ leader, workspaceName }: { leader: boolean; workspaceName: string }) {
  const pathname = usePathname();
  let section = leader ? 'Mesa de control' : 'Bandeja de validación';

  if (pathname.startsWith('/workspace/reparto')) section = 'Reparto de carga';
  else {
    const links = leader ? LEADER_LINKS : VALIDATOR_LINKS;
    section = links.find(({ href }) => isActivePath(pathname, href))?.label ?? section;
  }

  return (
    <div className="workspace-location">
      <small>{workspaceName}</small>
      <ViewTransition default="none" key={pathname} name="workspace-location" share="workspace-location-motion">
        <strong><span aria-hidden="true" />{section}</strong>
      </ViewTransition>
    </div>
  );
}
