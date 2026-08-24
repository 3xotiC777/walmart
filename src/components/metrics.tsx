export function MetricStrip({ items }: { items: Array<{ label: string; value: string | number; tone?: string }> }) {
  return <div className="metric-strip">{items.map((item) => <article className={`metric ${item.tone ?? ''}`} key={item.label}><i/><small>{item.label}</small><strong>{item.value}</strong></article>)}</div>;
}
