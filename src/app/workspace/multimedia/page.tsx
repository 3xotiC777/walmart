import { MultimediaViewer } from '@/components/multimedia-viewer';

export const metadata = { title: 'Multimedia' };

export default function MultimediaPage() {
  return (
    <>
      <header className="page-heading media-page-heading">
        <div>
          <p className="overline">VISOR MULTIMEDIA</p>
          <h1>Fotos y audios por entrevista</h1>
          <p>Carga tu exportación de Dooblo, busca un SubjectID y revisa su evidencia sin crear jornadas ni asignaciones.</p>
        </div>
      </header>
      <MultimediaViewer />
    </>
  );
}
