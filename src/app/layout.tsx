import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PQM Control Walmart', template: '%s · PQM Control' },
  description: 'Mesa colaborativa para detectar, repartir y corregir alertas del panel PQM.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
