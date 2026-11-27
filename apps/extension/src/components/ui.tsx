import type { Entry } from "@undoom/engine";
import { useState } from "react";
import { formatCountdown, formatMinutes, type Timer } from "@/lib/format";

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
export const TrashIcon = () => <Icon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />;
export const CheckIcon = () => <Icon d="M20 6 9 17l-5-5" />;
export const GlobeIcon = () => <Icon d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M2 12h20M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20" />;
export const PhoneIcon = () => <Icon d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01" />;
export const HourglassIcon = () => (
  <Icon d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2" />
);
export const MoonIcon = () => <Icon d="M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9z" />;
export const PlayIcon = () => <Icon d="M7 4l12 8-12 8z" />;
export const LogOutIcon = () => <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />;
export const UnlockIcon = () => <Icon d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 9.9-1" />;
export const ListIcon = () => <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
export const UserIcon = () => <Icon d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0" />;
export const ArrowLeftIcon = () => <Icon d="M19 12H5M12 19l-7-7 7-7" />;

/** The site's own favicon, fetched from the site rather than a favicon service so the list of limited sites stays private. */
export function Favicon({ entry }: { entry: Entry }) {
  const [failed, setFailed] = useState(false);
  const domain = entry.domains[0];
  if (domain === undefined || failed) {
    return <span className="favicon letter">{entry.name.charAt(0).toUpperCase()}</span>;
  }
  return <img className="favicon" src={`https://${domain}/favicon.ico`} alt="" onError={() => setFailed(true)} />;
}

/** One entry's icon, or up to four in a grid for a group. */
export function Tile({ entries, large = false }: { entries: Entry[]; large?: boolean }) {
  const group = entries.length > 1;
  return (
    <span className={`tile${group ? " group" : ""}${large ? " large" : ""}`} aria-hidden="true">
      {entries.slice(0, 4).map((e) => (
        <Favicon key={e.id} entry={e} />
      ))}
    </span>
  );
}

/** The domains and Android packages the entries cover, one line each. */
export function Identifiers({ entries }: { entries: Entry[] }) {
  const lines = [
    { key: "domains", icon: <GlobeIcon />, label: "Websites", items: entries.flatMap((e) => e.domains) },
    { key: "packages", icon: <PhoneIcon />, label: "Android apps", items: entries.flatMap((e) => e.packages) },
  ];
  return (
    <div className="identifiers">
      {lines.map(
        (line) =>
          line.items.length > 0 && (
            <div key={line.key} className={`identifier ${line.key}`} title={`${line.label}: ${line.items.join(", ")}`}>
              {line.icon}
              <span className="ellipsis">{line.items.join(", ")}</span>
            </div>
          ),
      )}
    </div>
  );
}

/** Session and rest lengths as icons, e.g. "⧗ 15 min ☾ 1 h". */
export function Durations({ sessionMs, restMs }: { sessionMs: number; restMs: number }) {
  return (
    <span className="durations">
      <span title="Session length">
        <HourglassIcon />
        {formatMinutes(sessionMs)}
      </span>
      <span title="Rest length">
        <MoonIcon />
        {formatMinutes(restMs)}
      </span>
    </span>
  );
}

const PILL: Record<Timer["phase"], { text: string; icon: typeof MoonIcon }> = {
  resting: { text: "Resting", icon: MoonIcon },
  session: { text: "In session", icon: PlayIcon },
  ready: { text: "Ready", icon: CheckIcon },
};

export function Pill({ phase, iconOnly = false }: { phase: Timer["phase"]; iconOnly?: boolean }) {
  const { text, icon: PillIcon } = PILL[phase];
  return (
    <span className={`pill ${phase}${iconOnly ? " icon-only" : ""}`} title={iconOnly ? text : undefined}>
      <PillIcon />
      {iconOnly ? <span className="sr-only">{text}</span> : text}
    </span>
  );
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
