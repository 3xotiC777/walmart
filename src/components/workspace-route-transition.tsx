'use client';

import { useEffect, useState, ViewTransition, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

const ROUTE_MOTION = {
  'workspace-back': 'workspace-route-back',
  'workspace-detail': 'workspace-route-forward',
  'workspace-tab': 'workspace-route-tab',
  default: 'workspace-route-default',
} as const;

export function WorkspaceRouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [supportsNativeMotion, setSupportsNativeMotion] = useState(false);

  useEffect(() => {
    setSupportsNativeMotion('startViewTransition' in document);
  }, []);

  return (
    <ViewTransition
      default="none"
      enter={ROUTE_MOTION}
      exit={ROUTE_MOTION}
      key={pathname}
      name="workspace-route"
      share={ROUTE_MOTION}
    >
      <div className={`workspace-route-frame${supportsNativeMotion ? '' : ' use-fallback-motion'}`}>{children}</div>
    </ViewTransition>
  );
}
