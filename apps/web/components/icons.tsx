import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const defaults = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function SearchIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M19.5 4.5C11 4.5 5.2 8 5.2 14.2c0 2.8 2 4.8 4.7 4.8 6.2 0 9.6-5.8 9.6-14.5Z" />
      <path d="M4 20c2.8-4.5 6.7-7.6 11.5-9.3" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 2.8c.6 4.7 2.6 7 7 7.7-4.4.6-6.4 3-7 7.7-.6-4.7-2.6-7.1-7-7.7 4.4-.7 6.4-3 7-7.7Z" />
    </svg>
  );
}

export function CoffeeIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 9h13v5.3A5.7 5.7 0 0 1 11.3 20H9.7A5.7 5.7 0 0 1 4 14.3V9Z" />
      <path d="M17 11h1.3a2.7 2.7 0 0 1 0 5.4H17M8 5.5c0-1 1-1.2 1-2.2M12 5.5c0-1 1-1.2 1-2.2" />
    </svg>
  );
}

export function DishIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 16.5h16M6 16.5a6 6 0 0 1 12 0M12 7V4.5M3 19.5h18" />
    </svg>
  );
}

export function DrinkIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M6.5 8h11l-1.2 12H7.7L6.5 8ZM5 4h12.5l-3.2 4M14.5 4l2-2" />
    </svg>
  );
}

export function CakeIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 10.5h16V20H4v-9.5ZM4 14c2 1.5 4 1.5 6 0 2 1.5 4 1.5 6 0 1.3 1 2.6 1.3 4 .7M7 10.5V8c0-2.8 2.2-4 5-4s5 1.2 5 4v2.5" />
    </svg>
  );
}

export function TeaIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 9h12v5.2a5.8 5.8 0 0 1-5.8 5.8h-.4A5.8 5.8 0 0 1 5 14.2V9Z" />
      <path d="M17 11h1.2a2.8 2.8 0 1 1 0 5.6H17M12 7c0-2.8 2-4 4-4-.1 2.8-1.8 4-4 4Z" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...defaults} {...props}>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 8.5A7 7 0 0 1 18.5 7L20 12M4 12l1.5 5A7 7 0 0 0 18 15.5" />
    </svg>
  );
}
