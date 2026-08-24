export default function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="workspace-loading" role="status">
      <span className="visually-hidden">Cargando la sección…</span>
      <header className="loading-heading" aria-hidden="true">
        <span className="skeleton skeleton-overline"/>
        <span className="skeleton skeleton-title"/>
        <span className="skeleton skeleton-copy"/>
      </header>
      <div className="loading-metrics" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <span className="skeleton" key={index}/>) }
      </div>
      <div className="loading-panels" aria-hidden="true">
        <span className="skeleton"/>
        <span className="skeleton"/>
      </div>
    </div>
  );
}
