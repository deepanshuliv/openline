



type IconProps = { size?: number; className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const handsetPath =
  "M4.5 3.5h3.2l1.4 4.2-2 1.6a12.6 12.6 0 0 0 5.6 5.6l1.6-2 4.2 1.4v3.2c0 1-.85 1.78-1.84 1.66-3.6-.44-6.98-2.05-9.6-4.66-2.6-2.6-4.22-6-4.66-9.6C2.72 4.35 3.5 3.5 4.5 3.5Z";


export function PhoneCallIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d={handsetPath} />
    </svg>
  );
}


export function PhoneOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      {...base}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={{ transform: "rotate(135deg)" }}
    >
      <path d={handsetPath} />
    </svg>
  );
}

export function MicIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

export function ActivityIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d="M3 12h4l2.5-7L13.5 19l2-7H21" />
    </svg>
  );
}
