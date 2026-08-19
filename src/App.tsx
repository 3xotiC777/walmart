import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, RefObject } from 'react';
import { ORTHOGRAPHY_RULE } from './lib/types';
import type { AlertRecord, RuleSummary, WorkerMessage, WorkerResult } from './lib/types';

type AppStatus = 'idle' | 'processing' | 'success' | 'error';

const PAGE_SIZE = 20;
const MAX_FILE_SIZE = 150 * 1024 * 1024;
const numberFormatter = new Intl.NumberFormat('es-CO');
const percentFormatter = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.6 2.9 8.3 7 10 4.1-1.7 7-5.4 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span className="metric-dot" />
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

interface UploadCardProps {
  title: string;
  description: string;
  file: File | null;
  inputRef: RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  onDragChange: (active: boolean) => void;
  onFileSelected: (file?: File) => void;
}

function UploadCard({
  title,
  description,
  file,
  inputRef,
  isDragging,
  onDragChange,
  onFileSelected,
}: UploadCardProps) {
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onDragChange(false);
    onFileSelected(event.dataTransfer.files[0]);
  };

  return (
    <article
      className={`file-upload-card ${file ? 'has-file' : ''} ${isDragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); onDragChange(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { event.preventDefault(); onDragChange(false); }}
      onDrop={handleDrop}
    >
      <div className="file-card-icon"><UploadIcon /></div>
      <div className="file-card-copy">
        <strong>{title}</strong>
        <p>{description}</p>
        {file && <span className="selected-file"><CheckIcon /> {file.name}</span>}
      </div>
      <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
        {file ? 'Cambiar archivo' : 'Seleccionar .xlsx'}
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => onFileSelected(event.target.files?.[0])}
      />
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function downloadResult(result: WorkerResult) {
  const blob = new Blob([result.outputBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `Revision_PQM_${date}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function App() {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [dragTarget, setDragTarget] = useState<'source' | 'invoice' | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [search, setSearch] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showAllRules, setShowAllRules] = useState(false);
  const [selectedInvoiceAlert, setSelectedInvoiceAlert] = useState<AlertRecord | null>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const reset = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus('idle');
    setSourceFile(null);
    setInvoiceFile(null);
    setDragTarget(null);
    setResult(null);
    setError('');
    setProgress(0);
    setProgressMessage('');
    setSearch('');
    setRuleFilter('');
    setPage(1);
    setSelectedInvoiceAlert(null);
    if (sourceInputRef.current) sourceInputRef.current.value = '';
    if (invoiceInputRef.current) invoiceInputRef.current.value = '';
  };

  const selectFile = (kind: 'source' | 'invoice', file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setStatus('error');
      setError('Selecciona un archivo con extensión .xlsx.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus('error');
      setError('El archivo supera el límite de 150 MB para procesamiento seguro en el navegador.');
      return;
    }

    if (kind === 'source') setSourceFile(file);
    else setInvoiceFile(file);
    setStatus('idle');
    setError('');
  };

  const analyzeFiles = async () => {
    if (!sourceFile || !invoiceFile) {
      setStatus('error');
      setError('Selecciona el panel PQM y el archivo de facturas antes de analizar.');
      return;
    }

    setStatus('processing');
    setError('');
    setResult(null);
    setProgress(5);
    setProgressMessage('Preparando el archivo…');

    try {
      const [sourceBuffer, invoiceBuffer] = await Promise.all([
        sourceFile.arrayBuffer(),
        invoiceFile.arrayBuffer(),
      ]);
      const worker = new Worker(new URL('./workers/validator.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'progress') {
          setProgress(message.progress);
          setProgressMessage(message.message);
          return;
        }
        if (message.type === 'error') {
          setStatus('error');
          setError(message.message);
          worker.terminate();
          workerRef.current = null;
          return;
        }
        setResult(message.payload);
        setStatus('success');
        worker.terminate();
        workerRef.current = null;
      };

      worker.onerror = () => {
        setStatus('error');
        setError('El navegador no pudo completar el análisis. Intenta nuevamente.');
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage(
        {
          sourceBuffer,
          sourceFileName: sourceFile.name,
          invoiceBuffer,
          invoiceFileName: invoiceFile.name,
        },
        [sourceBuffer, invoiceBuffer],
      );
    } catch {
      setStatus('error');
      setError('No fue posible abrir uno de los archivos seleccionados.');
    }
  };

  const allAlerts = useMemo(
    () => result ? [...result.alerts, ...result.orthographyAlerts] : [],
    [result],
  );
  const allRuleSummaries = useMemo(() => {
    if (!result) return [];
    const orthographySummary: RuleSummary = {
      ...ORTHOGRAPHY_RULE,
      affectedRows: result.orthographyAlerts.length,
      alertCount: result.orthographyAlerts.length,
    };
    return [...result.ruleSummaries, orthographySummary];
  }, [result]);

  const filteredAlerts = useMemo(() => {
    if (!result) return [];
    const query = search.trim().toLocaleUpperCase('es');
    return allAlerts.filter((alert) => {
      if (ruleFilter && alert.ruleId !== ruleFilter) return false;
      if (!query) return true;
      return [
        alert.ruleId,
        alert.ruleName,
        alert.rowId,
        alert.surveyId,
        alert.barcode,
        alert.description,
        alert.detail,
      ].some((value) => value.toLocaleUpperCase('es').includes(query));
    });
  }, [allAlerts, result, ruleFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE));
  const paginatedAlerts = filteredAlerts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const alertPercent = result?.metrics.totalRecords
    ? (result.metrics.totalAlerts / result.metrics.totalRecords) * 100
    : 0;
  const rulesWithAlerts = allRuleSummaries.filter((rule) => rule.alertCount > 0);
  const displayedRules =
    allRuleSummaries.filter((rule) => showAllRules || rule.alertCount > 0 || rule.id === 'R21');

  useEffect(() => setPage(1), [search, ruleFilter]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  useEffect(() => {
    if (!selectedInvoiceAlert) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedInvoiceAlert(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedInvoiceAlert]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Inicio del Validador PQM">
          <span className="brand-mark">PQM</span>
          <span>
            <strong>Validador Walmart</strong>
            <small>Control de calidad del panel</small>
          </span>
        </a>
        <span className="local-badge"><ShieldIcon /> Procesamiento 100% local</span>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">VALIDACIÓN AUTOMÁTICA</p>
            <h1>De 27 tablas dinámicas a una revisión clara.</h1>
            <p>
              Cruza el panel PQM con sus facturas, revisa las alertas con evidencia visual y descarga un Excel listo para validación.
            </p>
            <div className="hero-facts" aria-label="Características">
              <span><CheckIcon /> 27 controles automáticos</span>
              <span><CheckIcon /> Visor de facturas</span>
              <span><CheckIcon /> Sin subir datos</span>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="visual-card card-a"><span>01</span><b>Códigos</b><i /></div>
            <div className="visual-card card-b"><span>25</span><b>Precios</b><i /></div>
            <div className="visual-card card-c"><span>JER</span><b>Jerarquía</b><i /></div>
            <div className="visual-center"><CheckIcon /></div>
          </div>
        </section>

        {status !== 'success' && (
          <section className="workspace-card" aria-live="polite">
            {status === 'processing' ? (
              <div className="processing-state">
                <div className="spinner" aria-hidden="true" />
                <p className="eyebrow">ANALIZANDO</p>
                <h2>{progressMessage}</h2>
                <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p>{progress}% completado. El archivo permanece en este dispositivo.</p>
              </div>
            ) : (
              <>
                <div className="dropzone dual-upload-zone">
                  <div className="upload-icon"><UploadIcon /></div>
                  <p className="eyebrow">ARCHIVOS DE ENTRADA</p>
                  <h2>Panel PQM + facturas</h2>
                  <p>Selecciona ambos archivos para cruzar <strong>Id_Dn W</strong> con <strong>RefID_STG</strong>.</p>
                  <div className="upload-grid">
                    <UploadCard
                      title="1. Panel maestro PQM"
                      description="Debe incluir la hoja pqm consolidado."
                      file={sourceFile}
                      inputRef={sourceInputRef}
                      isDragging={dragTarget === 'source'}
                      onDragChange={(active) => setDragTarget(active ? 'source' : null)}
                      onFileSelected={(file) => selectFile('source', file)}
                    />
                    <UploadCard
                      title="2. Archivo de facturas"
                      description="Debe incluir RefID_STG y URL_DN en la hoja Data."
                      file={invoiceFile}
                      inputRef={invoiceInputRef}
                      isDragging={dragTarget === 'invoice'}
                      onDragChange={(active) => setDragTarget(active ? 'invoice' : null)}
                      onFileSelected={(file) => selectFile('invoice', file)}
                    />
                  </div>
                  <div className="upload-actions">
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!sourceFile || !invoiceFile}
                      onClick={() => void analyzeFiles()}
                    >
                      Analizar y cruzar facturas
                    </button>
                    <small>Tamaño máximo por archivo: 150 MB</small>
                  </div>
                </div>
                <aside className="privacy-note">
                  <ShieldIcon />
                  <div>
                    <strong>Tus datos no salen del navegador</strong>
                    <p>Los Excel se procesan localmente. Las imágenes de URL_DN se consultan únicamente cuando abres el visor.</p>
                  </div>
                </aside>
                {status === 'error' && (
                  <div className="error-banner" role="alert">
                    <strong>No se pudo analizar el archivo.</strong>
                    <span>{error}</span>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {status === 'success' && result && (
          <section className="results" aria-live="polite">
            <div className="results-heading">
              <div>
                <p className="eyebrow">ANÁLISIS COMPLETADO</p>
                <h2>Resultado de la validación</h2>
                <p className="file-line">
                  Panel: {result.sourceFile} · Facturas: {result.invoiceFile} ({numberFormatter.format(result.invoiceImages)} imágenes) · {formatDate(result.generatedAt)}
                </p>
              </div>
              <div className="heading-actions">
                <button className="secondary-button" type="button" onClick={reset}>Analizar otro archivo</button>
                <button className="primary-button download-button" type="button" onClick={() => downloadResult(result)}>
                  <DownloadIcon /> Descargar Excel
                </button>
              </div>
            </div>

            <div className="metrics-grid">
              <MetricCard label="Registros totales" value={numberFormatter.format(result.metrics.totalRecords)} tone="blue" />
              <MetricCard label="Alertas" value={numberFormatter.format(result.metrics.totalAlerts)} tone="orange" />
              <MetricCard label="Alertas ortográficas" value={numberFormatter.format(result.orthographyAlerts.length)} tone="purple" />
              <MetricCard label="Sin alertas" value={numberFormatter.format(result.metrics.okRecords)} tone="green" />
              <MetricCard label="Porcentaje de alertas" value={`${percentFormatter.format(alertPercent)}%`} tone="yellow" />
            </div>

            <div className="results-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">RESUMEN POR REGLA</p>
                  <h3>Controles activados</h3>
                </div>
                <button className="text-button" type="button" onClick={() => setShowAllRules((value) => !value)}>
                  {showAllRules ? 'Ver solo reglas con alertas' : 'Ver todas las reglas'}
                </button>
              </div>
              <div className="table-scroll">
                <table className="rules-table">
                  <thead><tr><th>Regla</th><th>Control</th><th>Estado</th><th>Registros afectados</th><th>Alertas</th></tr></thead>
                  <tbody>
                    {displayedRules.map((rule) => (
                      <tr key={rule.id}>
                        <td><span className="rule-code">{rule.id}</span></td>
                        <td><strong>{rule.name}</strong><small>{rule.description}</small></td>
                        <td><span className={`status-pill ${rule.status === 'Visual no automatizado' ? 'status-visual' : rule.alertCount > 0 ? 'status-alert' : 'status-ok'}`}>{rule.status === 'Visual no automatizado' ? 'Visual' : rule.alertCount > 0 ? 'Con alertas' : 'Sin alertas'}</span></td>
                        <td className="numeric-cell">{numberFormatter.format(rule.affectedRows)}</td>
                        <td className="numeric-cell">{numberFormatter.format(rule.alertCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="results-panel">
              <div className="panel-heading alerts-heading">
                <div>
                  <p className="eyebrow">DETALLE</p>
                  <h3>Alertas encontradas</h3>
                </div>
                <span className="result-count">{numberFormatter.format(filteredAlerts.length)} resultados</span>
              </div>
              <div className="filters-row">
                <label className="search-field">
                  <SearchIcon />
                  <span className="visually-hidden">Buscar alertas</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, descripción, ID…" />
                </label>
                <label className="select-field">
                  <span className="visually-hidden">Filtrar por regla</span>
                  <select value={ruleFilter} onChange={(event) => setRuleFilter(event.target.value)}>
                    <option value="">Todas las reglas</option>
                    {rulesWithAlerts.map((rule) => <option key={rule.id} value={rule.id}>{rule.id} · {rule.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="table-scroll">
                <table className="alerts-table">
                  <thead><tr><th>Regla</th><th>Fila</th><th>Código</th><th>Descripción</th><th>Motivo</th><th>Factura</th></tr></thead>
                  <tbody>
                    {paginatedAlerts.map((alert: AlertRecord) => (
                      <tr key={`${alert.ruleId}-${alert.sourceRow}`}>
                        <td><span className="rule-code alert-code">{alert.ruleId}</span></td>
                        <td>{numberFormatter.format(alert.sourceRow)}</td>
                        <td className="code-cell">{alert.barcode || '—'}</td>
                        <td>{alert.description || '—'}</td>
                        <td>{alert.detail}</td>
                        <td>
                          {alert.invoiceUrls?.length ? (
                            <button
                              className="invoice-view-button"
                              type="button"
                              onClick={() => setSelectedInvoiceAlert(alert)}
                              aria-label={`Ver ${alert.invoiceUrls.length === 1 ? 'factura' : `${alert.invoiceUrls.length} facturas`} de ${alert.surveyId}`}
                            >
                              Ver {alert.invoiceUrls.length === 1 ? 'factura' : `${alert.invoiceUrls.length} facturas`}
                            </button>
                          ) : (
                            <span className="invoice-missing">Sin factura</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {paginatedAlerts.length === 0 && (
                      <tr><td className="empty-table" colSpan={6}>No hay alertas que coincidan con los filtros.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span>Página {page} de {totalPages}</span>
                <div>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
                </div>
              </div>
            </div>

            <div className="download-callout">
              <div className="callout-icon"><DownloadIcon /></div>
              <div><strong>Excel listo para el equipo</strong><p>Incluye resumen, detalle de alertas, Foto_Factura y los registros originales deduplicados.</p></div>
              <button className="primary-button" type="button" onClick={() => downloadResult(result)}>Descargar resultado</button>
            </div>
          </section>
        )}
      </main>

      {selectedInvoiceAlert?.invoiceUrls?.length && (
        <div
          className="invoice-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedInvoiceAlert(null);
          }}
        >
          <section
            className="invoice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-viewer-title"
          >
            <header className="invoice-modal-header">
              <div>
                <p className="eyebrow">EVIDENCIA DE LA ALERTA</p>
                <h2 id="invoice-viewer-title">Visualizador de facturas</h2>
                <p>
                  <span className="rule-code alert-code">{selectedInvoiceAlert.ruleId}</span>
                  <strong>{selectedInvoiceAlert.description || 'Producto sin descripción'}</strong>
                </p>
                <small>Id_Dn W: {selectedInvoiceAlert.surveyId} · {selectedInvoiceAlert.invoiceUrls.length} {selectedInvoiceAlert.invoiceUrls.length === 1 ? 'imagen' : 'imágenes'}</small>
              </div>
              <button
                className="invoice-modal-close"
                type="button"
                onClick={() => setSelectedInvoiceAlert(null)}
                aria-label="Cerrar visualizador de facturas"
              >
                ×
              </button>
            </header>
            <div className="invoice-gallery">
              {selectedInvoiceAlert.invoiceUrls.map((url, index) => (
                <figure className="invoice-figure" key={url}>
                  <a href={url} target="_blank" rel="noreferrer" title="Abrir imagen original en una pestaña nueva">
                    <img
                      src={url}
                      alt={`Factura ${index + 1} del producto ${selectedInvoiceAlert.description || selectedInvoiceAlert.surveyId}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </a>
                  <figcaption>
                    <span>Factura {index + 1}</span>
                    <a href={url} target="_blank" rel="noreferrer">Abrir original ↗</a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        </div>
      )}

      <footer>
        <span>Validador PQM · Control de calidad</span>
        <span>Los datos permanecen en tu dispositivo</span>
      </footer>
    </div>
  );
}
