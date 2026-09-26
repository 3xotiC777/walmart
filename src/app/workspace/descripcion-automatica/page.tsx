import { AutomaticDescriptionUpload } from '@/components/automatic-description-upload';
import { requireViewer } from '@/lib/auth';

export const metadata = { title: 'Descripción automática' };
export default async function AutomaticDescriptionPage() {
  await requireViewer('leader');
  return <><header className="page-heading"><div><p className="overline">HERRAMIENTA INDEPENDIENTE</p><h1>Descripción automática</h1><p>Descarga una copia de la hoja original con sugerencias de descripción sin modificar las celdas existentes.</p></div></header><AutomaticDescriptionUpload /></>;
}
