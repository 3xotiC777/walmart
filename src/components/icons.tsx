import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function GridIcon(props: IconProps) { return <svg {...common} {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>; }
export function UploadCloudIcon(props: IconProps) { return <svg {...common} {...props}><path d="M7 18a4.6 4.6 0 0 1-.8-9.1A6 6 0 0 1 17.7 8 5 5 0 0 1 18 18h-3"/><path d="m9 13 3-3 3 3M12 10v10"/></svg>; }
export function UsersIcon(props: IconProps) { return <svg {...common} {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>; }
export function TasksIcon(props: IconProps) { return <svg {...common} {...props}><path d="M9 11 11 13 15 8"/><path d="M21 12a9 9 0 1 1-5-8.1"/></svg>; }
export function FileIcon(props: IconProps) { return <svg {...common} {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>; }
export function ArrowIcon(props: IconProps) { return <svg {...common} {...props}><path d="M5 12h14M13 6l6 6-6 6"/></svg>; }
export function LogoutIcon(props: IconProps) { return <svg {...common} {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>; }
export function LockIcon(props: IconProps) { return <svg {...common} {...props}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>; }
export function SearchIcon(props: IconProps) { return <svg {...common} {...props}><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>; }
export function ChevronIcon(props: IconProps) { return <svg {...common} {...props}><path d="m9 18 6-6-6-6"/></svg>; }
export function SparkIcon(props: IconProps) { return <svg {...common} {...props}><path d="m12 3-1.4 4.2a5 5 0 0 1-3.2 3.2L3 12l4.4 1.6a5 5 0 0 1 3.2 3.2L12 21l1.4-4.2a5 5 0 0 1 3.2-3.2L21 12l-4.4-1.6a5 5 0 0 1-3.2-3.2L12 3Z"/></svg>; }
export function CheckIcon(props: IconProps) { return <svg {...common} {...props}><path d="m5 12 4 4 10-10"/></svg>; }
export function EyeIcon(props: IconProps) { return <svg {...common} {...props}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>; }
export function DownloadIcon(props: IconProps) { return <svg {...common} {...props}><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>; }
export function AlertIcon(props: IconProps) { return <svg {...common} {...props}><path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>; }
