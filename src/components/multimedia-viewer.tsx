'use client';

import Image from 'next/image';
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type SyntheticEvent,
} from 'react';
import { combineMultimediaCatalogs } from '@/lib/multimedia-cross';
import type {
  CombinedMultimediaSubject,
  InterviewDataCatalog,
  MultimediaCatalog,
  MultimediaItem,
} from '@/lib/multimedia';
import { AlertIcon, CheckIcon, DownloadIcon, FileIcon, LockIcon, SearchIcon, UploadCloudIcon } from './icons';

type UploadKind = 'attachments' | 'data';
const MAX_FILE_SIZE = 100 * 1024 * 1024;

function formatBytes(value: number | null): string {
  if (value === null) return 'Tamaño no informado';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function mediaDescription(item: MultimediaItem): string {
  return item.variableName || item.questionText || (item.kind === 'image' ? 'Imagen capturada' : 'Audio capturado');
}

function audioMimeType(name: string): string {
  const fileExtension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (fileExtension === 'mp3') return 'audio/mpeg';
  if (fileExtension === 'wav') return 'audio/wav';
  if (fileExtension === 'aac') return 'audio/aac';
  if (fileExtension === 'ogg') return 'audio/ogg';
  return 'audio/mp4';
}

function hasMedia(subject: CombinedMultimediaSubject): boolean {
  return subject.images.length > 0 || subject.audios.length > 0;
}

function SpreadsheetUploadCard({
  title,
  step,
  description,
  fileName,
  summary,
  loading,
  error,
  onFile,
}: {
  title: string;
  step: string;
  description: string;
  fileName: string;
  summary: string;
  loading: boolean;
  error: string;
  onFile: (file: File | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    onFile(event.target.files?.[0] ?? null);
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    onFile(event.dataTransfer.files[0] ?? null);
  }

  function openPicker() {
    if (!fileInput.current) return;
    fileInput.current.value = '';
    fileInput.current.click();
  }

  return (
    <div className={`media-file-card ${fileName ? 'is-loaded' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <div
        className="media-file-drop"
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFile}
      >
        <span className="media-upload-icon">{fileName ? <CheckIcon /> : <UploadCloudIcon />}</span>
        <div>
          <p className="overline">{step}</p>
          <h2>{fileName || title}</h2>
          <p>{fileName ? summary : description}</p>
        </div>
        <button className="button button-primary" disabled={loading} onClick={openPicker} type="button">
          <FileIcon />{loading ? 'Leyendo archivo…' : fileName ? 'Cambiar archivo' : 'Seleccionar .xlsx'}
        </button>
        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label={title}
          onChange={selectFile}
          ref={fileInput}
          tabIndex={-1}
          type="file"
        />
      </div>
      {error && <p className="form-error media-error" role="alert"><AlertIcon />{error}</p>}
    </div>
  );
}

export function MultimediaViewer() {
  const [multimedia, setMultimedia] = useState<MultimediaCatalog | null>(null);
  const [interviewData, setInterviewData] = useState<InterviewDataCatalog | null>(null);
  const [selectedSubjectKey, setSelectedSubjectKey] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState<Record<UploadKind, boolean>>({ attachments: false, data: false });
  const [errors, setErrors] = useState<Record<UploadKind, string>>({ attachments: '', data: '' });
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const [brokenAudios, setBrokenAudios] = useState<Set<string>>(() => new Set());

  const subjects = useMemo(() => (
    multimedia && interviewData ? combineMultimediaCatalogs(multimedia, interviewData) : []
  ), [interviewData, multimedia]);
  const filteredSubjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    if (!normalized) return subjects;
    return subjects.filter((subject) => subject.subjectId.toLocaleLowerCase('es').includes(normalized));
  }, [query, subjects]);
  const selectedSubject = filteredSubjects.find((subject) => subject.subjectKey === selectedSubjectKey)
    ?? filteredSubjects[0]
    ?? null;
  const crossSummary = useMemo(() => subjects.reduce((summary, subject) => {
    const includesMedia = hasMedia(subject);
    const includesData = subject.dataRows.length > 0;
    if (includesMedia && includesData) summary.matched += 1;
    else if (includesMedia) summary.multimediaOnly += 1;
    else if (includesData) summary.dataOnly += 1;
    return summary;
  }, { matched: 0, multimediaOnly: 0, dataOnly: 0 }), [subjects]);

  async function loadFile(kind: UploadKind, file: File | null) {
    setErrors((current) => ({ ...current, [kind]: '' }));
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setErrors((current) => ({ ...current, [kind]: 'Selecciona un archivo en formato .xlsx.' }));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrors((current) => ({ ...current, [kind]: 'El archivo supera el máximo de 100 MB para esta vista local.' }));
      return;
    }

    setLoading((current) => ({ ...current, [kind]: true }));
    setQuery('');
    setSelectedSubjectKey('');
    try {
      const [{ parseInterviewDataWorkbook, parseMultimediaWorkbook }, buffer] = await Promise.all([
        import('@/lib/multimedia'),
        file.arrayBuffer(),
      ]);
      if (kind === 'attachments') {
        setMultimedia(parseMultimediaWorkbook(buffer, file.name));
        setBrokenImages(new Set());
        setBrokenAudios(new Set());
      } else {
        setInterviewData(parseInterviewDataWorkbook(buffer, file.name));
      }
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [kind]: cause instanceof Error ? cause.message : 'No fue posible leer el archivo.',
      }));
    } finally {
      setLoading((current) => ({ ...current, [kind]: false }));
    }
  }

  function markBroken(id: string) {
    setBrokenImages((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function markBrokenAudio(id: string) {
    setBrokenAudios((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function playOnlyThis(event: SyntheticEvent<HTMLAudioElement>) {
    const currentPlayer = event.currentTarget;
    document.querySelectorAll<HTMLAudioElement>('.media-audio-player').forEach((player) => {
      if (player !== currentPlayer) player.pause();
    });
  }

  return (
    <>
      <section className="panel media-upload-panel">
        <div className="media-file-pair">
          <SpreadsheetUploadCard
            description="Archivo con SubjectID, Name, TimeStamp e ImageURL."
            error={errors.attachments}
            fileName={multimedia?.sourceFile ?? ''}
            loading={loading.attachments}
            onFile={(file) => void loadFile('attachments', file)}
            step="1 · FOTOS Y AUDIOS"
            summary={multimedia ? `${multimedia.groups.length.toLocaleString('es-CO')} SubjectID · ${multimedia.totalImages.toLocaleString('es-CO')} imágenes · ${multimedia.totalAudios.toLocaleString('es-CO')} audios` : ''}
            title="Carga el listado multimedia de Dooblo"
          />
          <SpreadsheetUploadCard
            description="Solo SubjectID es obligatorio; las demás columnas pueden cambiar en cada estudio."
            error={errors.data}
            fileName={interviewData?.sourceFile ?? ''}
            loading={loading.data}
            onFile={(file) => void loadFile('data', file)}
            step="2 · DATOS DE LA ENTREVISTA"
            summary={interviewData ? `${interviewData.groups.length.toLocaleString('es-CO')} SubjectID · ${interviewData.columns.length.toLocaleString('es-CO')} campos adicionales` : ''}
            title="Carga los datos de ventas y reemplazos"
          />
        </div>
        <div className="media-local-note"><LockIcon /><span><strong>Cruce local por SubjectID.</strong> Ninguno de los dos archivos se guarda o comparte; desaparecen al recargar o cerrar la pestaña.</span></div>
      </section>

      {(!multimedia || !interviewData) && (
        <section className="panel media-cross-pending" aria-live="polite">
          <div className="media-cross-mark"><FileIcon /></div>
          <div><p className="overline">CRUCE PENDIENTE</p><h2>Completa los dos archivos</h2><p>La ficha combinada aparecerá cuando estén listos los adjuntos y los datos de la entrevista.</p></div>
          <ul>
            <li className={multimedia ? 'is-ready' : ''}>{multimedia ? <CheckIcon /> : <span>1</span>} Fotos y audios</li>
            <li className={interviewData ? 'is-ready' : ''}>{interviewData ? <CheckIcon /> : <span>2</span>} Datos por SubjectID</li>
          </ul>
        </section>
      )}

      {multimedia && interviewData && (
        <>
          <section className="media-metrics" aria-label="Resumen del cruce">
            <div><span>SubjectID totales</span><strong>{subjects.length.toLocaleString('es-CO')}</strong></div>
            <div><span>Cruce completo</span><strong>{crossSummary.matched.toLocaleString('es-CO')}</strong></div>
            <div className={crossSummary.multimediaOnly ? 'has-warning' : ''}><span>Solo multimedia</span><strong>{crossSummary.multimediaOnly.toLocaleString('es-CO')}</strong></div>
            <div className={crossSummary.dataOnly ? 'has-warning' : ''}><span>Solo datos</span><strong>{crossSummary.dataOnly.toLocaleString('es-CO')}</strong></div>
            <div><span>Imágenes y audios</span><strong>{(multimedia.totalImages + multimedia.totalAudios).toLocaleString('es-CO')}</strong></div>
            <div><span>Campos adicionales</span><strong>{interviewData.columns.length.toLocaleString('es-CO')}</strong></div>
          </section>

          <section className="panel media-workbench">
            <aside className="media-subject-pane" aria-label="Lista de SubjectID">
              <div className="media-subject-tools">
                <label className="search-control">
                  <span className="visually-hidden">Buscar SubjectID</span>
                  <SearchIcon />
                  <input className="form-control" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SubjectID…" type="search" value={query} />
                </label>
                <small>{filteredSubjects.length.toLocaleString('es-CO')} de {subjects.length.toLocaleString('es-CO')}</small>
              </div>
              <div className="media-subject-list">
                {filteredSubjects.map((subject) => (
                  <button
                    aria-label={`SubjectID ${subject.subjectId}, ${subject.images.length} imágenes, ${subject.audios.length} audios y ${subject.dataRows.length} registros de datos`}
                    aria-pressed={selectedSubject?.subjectKey === subject.subjectKey}
                    className={selectedSubject?.subjectKey === subject.subjectKey ? 'is-selected' : ''}
                    key={subject.subjectKey}
                    onClick={() => setSelectedSubjectKey(subject.subjectKey)}
                    type="button"
                  >
                    <span><strong>{subject.subjectId}</strong><small>{subject.timestamp}</small></span>
                    <span className="media-subject-counts"><b>{subject.images.length} img</b><b>{subject.audios.length} aud</b><b>{subject.dataRows.length} datos</b></span>
                  </button>
                ))}
                {filteredSubjects.length === 0 && <div className="media-list-empty"><SearchIcon /><p>No encontramos ese SubjectID.</p></div>}
              </div>
            </aside>

            <div className="media-detail-pane">
              {selectedSubject ? (
                <>
                  <header className="media-detail-header">
                    <div><p className="overline">EXPEDIENTE DE CAMPO</p><h2>SubjectID <span>{selectedSubject.subjectId}</span></h2><p>TimeStamp multimedia · {selectedSubject.timestamp}</p></div>
                    <div className="media-detail-counts"><span>{selectedSubject.images.length}<small>imágenes</small></span><span>{selectedSubject.audios.length}<small>audios</small></span><span>{selectedSubject.dataRows.length}<small>datos</small></span></div>
                  </header>

                  <section className="media-data-section">
                    <div className="media-section-heading">
                      <div><p className="overline">DATOS DE LA ENTREVISTA</p><h3>Información cruzada por SubjectID</h3><p>{interviewData.sourceFile} · hoja {interviewData.sheetName}</p></div>
                      <span>{interviewData.columns.length}</span>
                    </div>
                    {selectedSubject.dataRows.length > 0 ? selectedSubject.dataRows.map((dataRow, rowIndex) => (
                      <article className="media-data-record" key={dataRow.excelRow}>
                        <header><strong>{selectedSubject.dataRows.length > 1 ? `Registro ${rowIndex + 1}` : 'Registro encontrado'}</strong><small>Fila {dataRow.excelRow} del Excel de datos</small></header>
                        {dataRow.fields.length > 0 ? (
                          <dl className="media-data-grid">
                            {dataRow.fields.map((field) => (
                              <div className={field.value ? '' : 'is-empty'} key={field.columnIndex}>
                                <dt>{field.name}</dt><dd>{field.value || 'Sin dato'}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : <p className="media-data-empty">Este archivo solo contiene SubjectID; no hay campos adicionales para mostrar.</p>}
                      </article>
                    )) : <div className="media-data-missing"><AlertIcon /><div><strong>Este SubjectID no aparece en el Excel de datos.</strong><p>Las fotos y los audios siguen disponibles para revisión.</p></div></div>}
                  </section>

                  <div className="media-contact-sheet">
                    {selectedSubject.images.length > 0 ? selectedSubject.images.map((item, index) => {
                      const unavailable = !item.available || brokenImages.has(item.id);
                      return (
                        <figure className={unavailable ? 'is-unavailable' : ''} key={item.id}>
                          <div className="media-image-frame">
                            {unavailable ? (
                              <div className="media-unavailable"><AlertIcon /><strong>Imagen no disponible</strong><small>{item.available ? 'Dooblo no devolvió un JPG.' : 'El archivo figura incompleto o sin contenido.'}</small></div>
                            ) : (
                              <a aria-label={`Abrir imagen ${index + 1} de ${selectedSubject.subjectId}`} href={item.url} rel="noreferrer" target="_blank">
                                <Image alt={`${mediaDescription(item)} del SubjectID ${selectedSubject.subjectId}`} fill onError={() => markBroken(item.id)} referrerPolicy="no-referrer" sizes="(max-width: 800px) 100vw, (max-width: 1250px) 50vw, 33vw" src={item.url} unoptimized />
                              </a>
                            )}
                          </div>
                          <figcaption><span><strong>{mediaDescription(item)}</strong><small>{item.timestamp} · {formatBytes(item.size)}</small></span><b>{index + 1}</b></figcaption>
                        </figure>
                      );
                    }) : <div className="media-no-images"><AlertIcon /><strong>Este SubjectID no tiene imágenes.</strong><p>Revisa los datos cruzados y los audios disponibles.</p></div>}
                  </div>

                  <section className="media-audio-section">
                    <div className="media-section-heading"><div><p className="overline">ARCHIVOS DE AUDIO</p><h3>Grabaciones disponibles</h3></div><span>{selectedSubject.audios.length}</span></div>
                    {selectedSubject.audios.length > 0 ? (
                      <div className="media-audio-list">
                        {selectedSubject.audios.map((item, index) => (
                          <article className={!item.available ? 'is-unavailable' : ''} key={item.id}>
                            <span className="media-audio-index">{String(index + 1).padStart(2, '0')}</span>
                            <div><strong>{item.name}</strong><small>{item.timestamp} · {formatBytes(item.size)}</small></div>
                            {item.available && !brokenAudios.has(item.id) ? (
                              <audio aria-label={`Reproducir ${item.name}`} className="media-audio-player" controls controlsList="nodownload noplaybackrate" onError={() => markBrokenAudio(item.id)} onPlay={playOnlyThis} preload="none">
                                <source src={item.url} type={audioMimeType(item.name)} />
                                Tu navegador no puede reproducir este audio.
                              </audio>
                            ) : item.available ? <span className="media-playback-error">No se pudo reproducir aquí</span> : null}
                            {item.available ? <a className="button button-secondary" href={item.url} rel="noreferrer" target="_blank"><DownloadIcon />Descargar audio</a> : <span className="status pending">No disponible</span>}
                          </article>
                        ))}
                      </div>
                    ) : <p className="media-audio-empty">No hay audios asociados con este SubjectID.</p>}
                  </section>
                </>
              ) : <div className="media-detail-empty"><SearchIcon /><h2>Selecciona un SubjectID</h2><p>La evidencia y los datos aparecerán en este panel.</p></div>}
            </div>
          </section>

          {(multimedia.ignoredRows > 0 || interviewData.ignoredRows > 0) && (
            <p className="media-footnote">Filas omitidas: {multimedia.ignoredRows.toLocaleString('es-CO')} en multimedia y {interviewData.ignoredRows.toLocaleString('es-CO')} en datos por falta de SubjectID o contenido compatible.</p>
          )}
        </>
      )}
    </>
  );
}
