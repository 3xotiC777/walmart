'use client';

import Image from 'next/image';
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type SyntheticEvent } from 'react';
import type { MultimediaCatalog, MultimediaItem } from '@/lib/multimedia';
import { AlertIcon, DownloadIcon, FileIcon, LockIcon, SearchIcon, UploadCloudIcon } from './icons';

type Phase = 'idle' | 'reading' | 'ready' | 'error';
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

export function MultimediaViewer() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [catalog, setCatalog] = useState<MultimediaCatalog | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const [brokenAudios, setBrokenAudios] = useState<Set<string>>(() => new Set());

  const filteredGroups = useMemo(() => {
    if (!catalog) return [];
    const normalized = query.trim().toLocaleLowerCase('es');
    if (!normalized) return catalog.groups;
    return catalog.groups.filter((group) => group.subjectId.toLocaleLowerCase('es').includes(normalized));
  }, [catalog, query]);

  const selectedGroup = filteredGroups.find((group) => group.subjectId === selectedSubjectId)
    ?? filteredGroups[0]
    ?? null;

  async function loadFile(file: File | null) {
    setDragging(false);
    setError('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setPhase('error');
      setError('Selecciona un archivo de adjuntos en formato .xlsx.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPhase('error');
      setError('El archivo supera el máximo de 100 MB para esta vista local.');
      return;
    }

    setPhase('reading');
    setCatalog(null);
    setQuery('');
    setBrokenImages(new Set());
    setBrokenAudios(new Set());
    try {
      const [{ parseMultimediaWorkbook }, buffer] = await Promise.all([
        import('@/lib/multimedia'),
        file.arrayBuffer(),
      ]);
      const nextCatalog = parseMultimediaWorkbook(buffer, file.name);
      setCatalog(nextCatalog);
      setSelectedSubjectId(nextCatalog.groups[0]?.subjectId ?? '');
      setPhase('ready');
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error ? cause.message : 'No fue posible leer el archivo.');
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    void loadFile(event.target.files?.[0] ?? null);
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void loadFile(event.dataTransfer.files[0] ?? null);
  }

  function openPicker() {
    if (!fileInput.current) return;
    fileInput.current.value = '';
    fileInput.current.click();
  }

  function markBroken(id: string) {
    setBrokenImages((current) => {
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

  function markBrokenAudio(id: string) {
    setBrokenAudios((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  return (
    <>
      <section className={`panel media-upload-panel ${catalog ? 'is-compact' : ''}`}>
        <div
          className={`media-file-drop ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropFile}
        >
          <span className="media-upload-icon"><UploadCloudIcon /></span>
          <div>
            <p className="overline">ARCHIVO PERSONAL</p>
            <h2>{catalog ? catalog.sourceFile : 'Carga el listado multimedia de Dooblo'}</h2>
            <p>{catalog ? `${catalog.groups.length.toLocaleString('es-CO')} SubjectID listos para revisar.` : 'Arrastra el .xlsx o selecciónalo desde tu equipo.'}</p>
          </div>
          <button className="button button-primary" disabled={phase === 'reading'} onClick={openPicker} type="button">
            <FileIcon />{catalog ? 'Cambiar archivo' : phase === 'reading' ? 'Leyendo archivo…' : 'Seleccionar .xlsx'}
          </button>
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Archivo multimedia de Dooblo"
            onChange={selectFile}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
        </div>
        <div className="media-local-note"><LockIcon /><span><strong>Uso local.</strong> El archivo no se guarda ni se comparte; se elimina de esta vista al recargar o cerrar la pestaña.</span></div>
        {error && <p className="form-error media-error" role="alert"><AlertIcon />{error}</p>}
      </section>

      {phase === 'reading' && (
        <section className="panel media-reading" aria-live="polite">
          <span className="media-spinner" />
          <div><strong>Organizando imágenes y audios…</strong><p>La lectura ocurre únicamente en este navegador.</p></div>
        </section>
      )}

      {catalog && phase === 'ready' && (
        <>
          <section className="media-metrics" aria-label="Resumen del archivo">
            <div><span>SubjectID</span><strong>{catalog.groups.length.toLocaleString('es-CO')}</strong></div>
            <div><span>Imágenes</span><strong>{catalog.totalImages.toLocaleString('es-CO')}</strong></div>
            <div><span>Audios</span><strong>{catalog.totalAudios.toLocaleString('es-CO')}</strong></div>
            <div className={catalog.unavailableItems ? 'has-warning' : ''}><span>No disponibles</span><strong>{catalog.unavailableItems.toLocaleString('es-CO')}</strong></div>
          </section>

          <section className="panel media-workbench">
            <aside className="media-subject-pane" aria-label="Lista de SubjectID">
              <div className="media-subject-tools">
                <label className="search-control">
                  <span className="visually-hidden">Buscar SubjectID</span>
                  <SearchIcon />
                  <input className="form-control" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SubjectID…" type="search" value={query} />
                </label>
                <small>{filteredGroups.length.toLocaleString('es-CO')} de {catalog.groups.length.toLocaleString('es-CO')}</small>
              </div>
              <div className="media-subject-list">
                {filteredGroups.map((group) => (
                  <button
                    aria-label={`SubjectID ${group.subjectId}, ${group.timestamp}, ${group.images.length} imágenes y ${group.audios.length} audios`}
                    aria-pressed={selectedGroup?.subjectId === group.subjectId}
                    className={selectedGroup?.subjectId === group.subjectId ? 'is-selected' : ''}
                    key={group.subjectId}
                    onClick={() => setSelectedSubjectId(group.subjectId)}
                    type="button"
                  >
                    <span><strong>{group.subjectId}</strong><small>{group.timestamp}</small></span>
                    <span className="media-subject-counts"><b>{group.images.length} img</b><b>{group.audios.length} aud</b></span>
                  </button>
                ))}
                {filteredGroups.length === 0 && <div className="media-list-empty"><SearchIcon /><p>No encontramos ese SubjectID.</p></div>}
              </div>
            </aside>

            <div className="media-detail-pane">
              {selectedGroup ? (
                <>
                  <header className="media-detail-header">
                    <div><p className="overline">EVIDENCIA DE CAMPO</p><h2>SubjectID <span>{selectedGroup.subjectId}</span></h2><p>TimeStamp · {selectedGroup.timestamp}</p></div>
                    <div className="media-detail-counts"><span>{selectedGroup.images.length}<small>imágenes</small></span><span>{selectedGroup.audios.length}<small>audios</small></span></div>
                  </header>

                  <div className="media-contact-sheet">
                    {selectedGroup.images.length > 0 ? selectedGroup.images.map((item, index) => {
                      const unavailable = !item.available || brokenImages.has(item.id);
                      return (
                        <figure className={unavailable ? 'is-unavailable' : ''} key={item.id}>
                          <div className="media-image-frame">
                            {unavailable ? (
                              <div className="media-unavailable"><AlertIcon /><strong>Imagen no disponible</strong><small>{item.available ? 'Dooblo no devolvió un JPG.' : 'El archivo figura incompleto o sin contenido.'}</small></div>
                            ) : (
                              <a aria-label={`Abrir imagen ${index + 1} de ${selectedGroup.subjectId}`} href={item.url} rel="noreferrer" target="_blank">
                                <Image
                                  alt={`${mediaDescription(item)} del SubjectID ${selectedGroup.subjectId}`}
                                  fill
                                  onError={() => markBroken(item.id)}
                                  referrerPolicy="no-referrer"
                                  sizes="(max-width: 800px) 100vw, (max-width: 1250px) 50vw, 33vw"
                                  src={item.url}
                                  unoptimized
                                />
                              </a>
                            )}
                          </div>
                          <figcaption><span><strong>{mediaDescription(item)}</strong><small>{item.timestamp} · {formatBytes(item.size)}</small></span><b>{index + 1}</b></figcaption>
                        </figure>
                      );
                    }) : (
                      <div className="media-no-images"><AlertIcon /><strong>Este SubjectID no tiene imágenes.</strong><p>Los audios disponibles aparecen debajo.</p></div>
                    )}
                  </div>

                  <section className="media-audio-section">
                    <div className="media-section-heading"><div><p className="overline">ARCHIVOS DE AUDIO</p><h3>Grabaciones disponibles</h3></div><span>{selectedGroup.audios.length}</span></div>
                    {selectedGroup.audios.length > 0 ? (
                      <div className="media-audio-list">
                        {selectedGroup.audios.map((item, index) => (
                          <article className={!item.available ? 'is-unavailable' : ''} key={item.id}>
                            <span className="media-audio-index">{String(index + 1).padStart(2, '0')}</span>
                            <div><strong>{item.name}</strong><small>{item.timestamp} · {formatBytes(item.size)}</small></div>
                            {item.available && !brokenAudios.has(item.id) ? (
                              <audio
                                aria-label={`Reproducir ${item.name}`}
                                className="media-audio-player"
                                controls
                                controlsList="nodownload noplaybackrate"
                                onError={() => markBrokenAudio(item.id)}
                                onPlay={playOnlyThis}
                                preload="none"
                              >
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
              ) : <div className="media-detail-empty"><SearchIcon /><h2>Selecciona un SubjectID</h2><p>La evidencia aparecerá en este panel.</p></div>}
            </div>
          </section>

          {catalog.ignoredRows > 0 && <p className="media-footnote">Se omitieron {catalog.ignoredRows.toLocaleString('es-CO')} filas sin una extensión compatible o sin un enlace válido de Dooblo.</p>}
        </>
      )}
    </>
  );
}
