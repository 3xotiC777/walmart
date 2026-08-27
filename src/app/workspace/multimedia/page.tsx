import { MultimediaViewer } from '@/components/multimedia-viewer';

export const metadata = { title: 'Multimedia' };

export default function MultimediaPage() {
  return (
    <>
      <header className="page-heading media-page-heading">
        <div>
          <p className="overline">VISOR MULTIMEDIA</p>
          <h1>Expediente completo por entrevista</h1>
          <p>Cruza fotos y audios con los datos del levantamiento mediante SubjectID y revisa toda la evidencia en un solo lugar.</p>
        </div>
      </header>
      <MultimediaViewer />
    </>
  );
}
