import type { ReactNode } from "react";

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function MenuIcon() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}
export function ServiceBellIcon() {
  return (
    <Icon>
      <path d="M4 17a8 8 0 0 1 16 0M3 17h18M3 20h18M12 9V6M10 6h4" />
      <path className="service-bell__signal service-bell__signal--near" d="M5 7a10 10 0 0 1 14 0" />
      <path className="service-bell__signal service-bell__signal--far" d="M2 4a14 14 0 0 1 20 0" />
    </Icon>
  );
}
export function OrdersIcon() {
  return (
    <Icon>
      <rect x="5" y="5" width="14" height="17" rx="2" />
      <path d="M9 5.5V4a3 3 0 0 1 6 0v1.5" />
      <path d="M10 11h6M10 15h6" />
    </Icon>
  );
}
export function SettingsIcon() {
  return (
    <Icon>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="var(--surface-overlay)" />
      <circle cx="15" cy="12" r="2" fill="var(--surface-overlay)" />
      <circle cx="8" cy="18" r="2" fill="var(--surface-overlay)" />
    </Icon>
  );
}
export function AccountingIcon() {
  return (
    <Icon>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 9h16M8 14h3M15 14h2" />
    </Icon>
  );
}
export function CatalogIcon() {
  return (
    <Icon>
      <circle cx="7" cy="7" r="2.3" />
      <circle cx="17" cy="7" r="2.3" />
      <circle cx="7" cy="17" r="2.3" />
      <circle cx="17" cy="17" r="2.3" />
    </Icon>
  );
}
export function InventoryIcon() {
  return (
    <Icon>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" />
    </Icon>
  );
}
export function TableIcon() {
  return (
    <Icon>
      <path d="M5 9h14v7H5zM7 16v4M17 16v4M8 9V5h8v4" />
    </Icon>
  );
}
export function BagIcon() {
  return (
    <Icon>
      <path d="M5 8h14l-1 13H6L5 8Z" />
      <path d="M9 10V6a3 3 0 0 1 6 0v4" />
    </Icon>
  );
}
export function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}
export function CheckIcon() {
  return (
    <Icon>
      <path d="m5 12 4 4L19 6" />
    </Icon>
  );
}
export function CupIcon() {
  return (
    <Icon>
      <path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8Z" />
      <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M4 21h15" />
    </Icon>
  );
}
export function ChevronIcon() {
  return (
    <Icon>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}
export function RefreshIcon() {
  return (
    <Icon>
      <path d="M20 11a8 8 0 0 0-14.7-4.2L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.7 4.2L20 16" />
      <path d="M20 20v-4h-4" />
    </Icon>
  );
}
export function WifiIcon() {
  return (
    <Icon>
      <path d="M3.5 8.8a13.5 13.5 0 0 1 17 0" />
      <path d="M6.8 12.5a8.3 8.3 0 0 1 10.4 0" />
      <path d="M10 16.1a3.2 3.2 0 0 1 4 0" />
      <circle cx="12" cy="19.2" r=".75" fill="currentColor" stroke="none" />
    </Icon>
  );
}
export function ExitIcon() {
  return (
    <Icon>
      <path d="M14 4h5v16h-5" />
      <path d="M3 12h11m-4-4 4 4-4 4" />
    </Icon>
  );
}
export function SunIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </Icon>
  );
}
export function AlertIcon() {
  return (
    <Icon>
      <path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3Z" />
      <path d="M12 9v4M12 17h.01" />
    </Icon>
  );
}
export function CloseIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}
export function EditIcon() {
  return (
    <Icon>
      <path d="m14 5 5 5M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z" />
    </Icon>
  );
}
export function TrashIcon() {
  return (
    <Icon>
      <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7" />
      <path d="M10 11v5M14 11v5" />
    </Icon>
  );
}
