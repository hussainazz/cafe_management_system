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
export function OrdersIcon() {
  return (
    <Icon>
      <path d="M7 3h10v3H7zM6 5H4v16h16V5h-2" />
      <path d="M8 11h8M8 15h8" />
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
      <path d="M10 17l5-5-5-5M15 12H3M21 3v18" />
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
