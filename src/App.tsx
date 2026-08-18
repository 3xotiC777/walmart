import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlertRecord, WorkerMessage, WorkerResult } from './lib/types';

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
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [search, setSearch] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showAllRules, setShowAllRules] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const reset = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus('idle');
    setResult(null);
    setError('');
    setProgress(0);
    setProgressMessage('');
    setSearch('');
    setRuleFilter('');
    setPage(1);
    if (inputRef.current) inputRef.current.value = '';
  };

  const analyzeFile = async (file?: File) => {
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

    setStatus('processing');
    setError('');
    setResult(null);
    setProgress(5);
    setProgressMessage('Preparando el archivo…');

    try {
      const buffer = await file.arrayBuffer();
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

      worker.postMessage({ buffer, fileName: file.name }, [buffer]);
    } catch {
      setStatus('error');
      setError('No fue posible abrir el archivo seleccionado.');
    }
  };

  const filteredAlerts = useMemo(() => {
    if (!result) return [];
    const query = search.trim().toLocaleUpperCase('es');
    return result.alerts.filter((alert) => {
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
  }, [result, ruleFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE));
  const paginatedAlerts = filteredAlerts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rulesWithAlerts = result?.ruleSummaries.filter((rule) => rule.affectedRows > 0) ?? [];
  const displayedRules =
    result?.ruleSummaries.filter((rule) => showAllRules || rule.affectedRows > 0 || rule.id === 'R21') ?? [];

  useEffect(() => setPage(1), [search, ruleFilter]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
              Carga el archivo del panel, identifica los registros que necesitan atención y descarga un Excel listo para el equipo de validación.
            </p>
            <div className="hero-facts" aria-label="Características">
              <span><CheckIcon /> 26 controles automáticos</span>
              <span><CheckIcon /> Jerarquía integrada</span>
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
                <div
                  className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    void analyzeFile(event.dataTransfer.files[0]);
                  }}
                >
                  <div className="upload-icon"><UploadIcon /></div>
                  <p className="eyebrow">ARCHIVO DE ENTRADA</p>
                  <h2>Arrastra aquí el Excel de PQM</h2>
                  <p>Debe incluir la hoja <strong>pqm consolidado</strong> con su estructura habitual.</p>
                  <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>
                    Seleccionar archivo .xlsx
                  </button>
                  <input
                    ref={inputRef}
                    className="visually-hidden"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => void analyzeFile(event.target.files?.[0])}
                  />
                  <small>Tamaño máximo: 150 MB</small>
                </div>
                <aside className="privacy-note">
                  <ShieldIcon />
                  <div>
                    <strong>Tus datos no salen del navegador</strong>
                    <p>El análisis y la creación del Excel ocurren localmente. La página no guarda ni transmite el archivo.</p>
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
                <p className="file-line">{result.sourceFile} · {formatDate(result.generatedAt)} · {numberFormatter.format(result.hierarchyProducts)} productos en jerarquía</p>
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
              <MetricCard label="A revisar" value={numberFormatter.format(result.metrics.reviewRecords)} tone="orange" />
              <MetricCard label="Sin alertas" value={numberFormatter.format(result.metrics.okRecords)} tone="green" />
              <MetricCard label="Porcentaje a revisar" value={`${percentFormatter.format(result.metrics.reviewPercent)}%`} tone="yellow" />
              <MetricCard label="Eventos de alerta" value={numberFormatter.format(result.metrics.totalAlerts)} tone="navy" />
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
                  <thead><tr><th>Regla</th><th>Control</th><th>Estado</th><th>Registros</th></tr></thead>
                  <tbody>
                    {displayedRules.map((rule) => (
                      <tr key={rule.id}>
                        <td><span className="rule-code">{rule.id}</span></td>
                        <td><strong>{rule.name}</strong><small>{rule.description}</small></td>
                        <td><span className={`status-pill ${rule.status === 'Visual no automatizado' ? 'status-visual' : rule.affectedRows > 0 ? 'status-alert' : 'status-ok'}`}>{rule.status === 'Visual no automatizado' ? 'Visual' : rule.affectedRows > 0 ? 'Con alertas' : 'Sin alertas'}</span></td>
                        <td className="numeric-cell">{numberFormatter.format(rule.affectedRows)}</td>
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
                  <thead><tr><th>Regla</th><th>Fila</th><th>Código</th><th>Descripción</th><th>Motivo</th></tr></thead>
                  <tbody>
                    {paginatedAlerts.map((alert: AlertRecord) => (
                      <tr key={`${alert.ruleId}-${alert.sourceRow}`}>
                        <td><span className="rule-code alert-code">{alert.ruleId}</span></td>
                        <td>{numberFormatter.format(alert.sourceRow)}</td>
                        <td className="code-cell">{alert.barcode || '—'}</td>
                        <td>{alert.description || '—'}</td>
                        <td>{alert.detail}</td>
                      </tr>
                    ))}
                    {paginatedAlerts.length === 0 && (
                      <tr><td className="empty-table" colSpan={5}>No hay alertas que coincidan con los filtros.</td></tr>
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
              <div><strong>Excel listo para el equipo</strong><p>Incluye resumen, detalle de alertas y los registros originales deduplicados.</p></div>
              <button className="primary-button" type="button" onClick={() => downloadResult(result)}>Descargar resultado</button>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>Validador PQM · Control de calidad</span>
        <span>Los datos permanecen en tu dispositivo</span>
      </footer>
    </div>
  );
}
