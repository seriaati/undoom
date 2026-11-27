import { formatCountdown, type Timer } from "@/lib/format";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2b5a8a" />
      <g fill="#fff">
        <rect x="7.6" y="8.6" width="16" height="3.2" rx="1.6" />
        <rect x="7.6" y="14" width="16" height="3.2" rx="1.6" />
        <rect x="7.6" y="19.4" width="8" height="3.2" rx="1.6" />
        <circle cx="22" cy="21" r="2.4" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <Logo />
      Undoom
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const PlusIcon = () => <Icon d="M12 5v14M5 12h14" />;
export const CloseIcon = () => <Icon d="M6 6l12 12M18 6 6 18" />;
export const EditIcon = () => <Icon d="M4 20h4L19 9l-4-4L4 16v4z" />;
export const KeyIcon = () => <Icon d="M4 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0M10.9 12.1 20 3M16 7l3 3M13.5 9.5l2 2" />;
export const SettingsIcon = () => (
  <Icon d="M4 7h9M17 7h3M4 17h3M11 17h9M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0" />
);

export function Tile({ name }: { name: string }) {
  return (
    <span className="tile" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const PILL_TEXT: Record<Timer["phase"], string> = { resting: "Resting", session: "In session", ready: "Ready" };

export function Pill({ phase }: { phase: Timer["phase"] }) {
  return <span className={`pill ${phase}`}>{PILL_TEXT[phase]}</span>;
}

export function Countdown({ timer }: { timer: Timer }) {
  return (
    <>
      <div className="big">
        <span className={`count ${timer.phase}`}>{formatCountdown(timer.ms)}</span>
        <span className="muted small">{timer.label}</span>
      </div>
      <div className={`progress ${timer.phase}`}>
        <i style={{ width: `${timer.progress * 100}%` }} />
      </div>
    </>
  );
}
