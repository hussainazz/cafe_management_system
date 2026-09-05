import type { ReactNode } from "react";

type IconProps = { children: ReactNode; className?: string };

function Icon({ children, className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function RefreshIcon() {
  return <Icon><path d="M20 11a8 8 0 1 0 2 5.5" /><path d="M20 4v7h-7" /></Icon>;
}

export function SignalIcon() {
  return <Icon><path d="M4 19h16" /><path d="M7 16v-3" /><path d="M12 16V9" /><path d="M17 16V5" /></Icon>;
}

export function WarningIcon() {
  return <Icon><path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></Icon>;
}

export function ExitIcon() {
  return <Icon><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></Icon>;
}

export function CoffeeMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" fill="none">
      <path d="M8 11h18v10.2c0 4-3.4 7.3-7.6 7.3h-2.8C11.4 28.5 8 25.2 8 21.2V11Z" stroke="currentColor" strokeWidth="2.1" />
      <path d="M26 14h2.2a3.8 3.8 0 0 1 0 7.6H26" stroke="currentColor" strokeWidth="2.1" />
      <path d="M12 7.5c0-1.2.8-2.2 1.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 7.5c0-1.2.8-2.2 1.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 31h22" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}
