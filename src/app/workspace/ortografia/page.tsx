import { OrthographyTraining } from '@/components/orthography-training';
import { requireViewer } from '@/lib/auth';

export const metadata = { title: 'Vocabulario de ortografía' };
export default async function OrthographyPage() {
  await requireViewer('leader');
  return <><header className="page-heading"><div><p className="overline">APRENDIZAJE</p><h1>Ortografía</h1><p>Enseña palabras correctas e incorrectas a la revisión de próximas jornadas.</p></div></header><OrthographyTraining /></>;
}
