import { AppShell } from '@/components/app-shell';
import { requireViewer } from '@/lib/auth';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
