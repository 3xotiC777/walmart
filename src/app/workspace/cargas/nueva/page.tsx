import { UploadWorkspace } from '@/components/upload-workspace';
import { requireViewer } from '@/lib/auth';

export const metadata = { title: 'Nueva jornada' };

export default async function NewUploadPage() {
  await requireViewer('leader');
  return <><header className="page-heading"><div><p className="overline">NUEVA JORNADA</p><h1>Cargar y preparar la revisión</h1><p>La base se valida en tu navegador. Supabase conserva una sola copia privada y únicamente el contexto necesario para trabajar.</p></div></header><UploadWorkspace /></>;
}
