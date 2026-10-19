const paths = {
  chev: <path d="M5 7.5l5 5 5-5" />,
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </>
  ),
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  unlock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 015.8-1.1" />
    </>
  ),
  pencil: <path d="M12.5 4.5l3 3-8.5 8.5H4v-3zM11 6l3 3" />,
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="M13 13l3.5 3.5" />
    </>
  ),
  download: <path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4.5 16.5h11" />,
  upload: <path d="M10 13V3.5M6.5 7L10 3.5 13.5 7M4.5 16.5h11" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  join: <path d="M8.5 11.5a3.5 3.5 0 005 0l2.5-2.5a3.5 3.5 0 00-5-5l-1 1M11.5 8.5a3.5 3.5 0 00-5 0L4 11a3.5 3.5 0 005 5l1-1" />,
  warn: (
    <>
      <path d="M10 3.5l7 12.5H3z" />
      <path d="M10 8.5v3.5M10 14.2v.1" />
    </>
  ),
  ext: (
    <>
      <path d="M8 4.5H4.5v11h11V12" />
      <path d="M11 4.5h4.5V9M15.5 4.5L9 11" />
    </>
  ),
  file: (
    <>
      <path d="M5 2.5h6.5l3.5 3.5v11.5H5z" />
      <path d="M11.5 2.5V6H15" />
    </>
  ),
  copy: (
    <>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
      <path d="M13 7V4.5A1 1 0 0012 3.5H4.5a1 1 0 00-1 1V12a1 1 0 001 1H7" />
    </>
  ),
  camera: (
    <>
      <rect x="2.5" y="6" width="15" height="10" rx="1.5" />
      <path d="M7 6l1.2-2h3.6L13 6" />
      <circle cx="10" cy="11" r="2.8" />
    </>
  ),
  retry: (
    <>
      <path d="M15.5 10a5.5 5.5 0 11-1.6-3.9" />
      <path d="M15.5 3.5v3h-3" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 9.5L10 4l6.5 5.5" />
      <path d="M5.5 8.5v8h9v-8" />
    </>
  ),
  send: <path d="M10 16V4.5M5 9.5l5-5 5 5" />,
  recv: <path d="M10 4v11.5M5 10.5l5 5 5-5" />,
  coins: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="12.5" cy="12.5" r="4.5" />
    </>
  ),
  scan: <path d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13M3.5 10h13" />,
  settings: (
    <>
      <path d="M3.5 6h6M13.5 6h3M3.5 14h3M10.5 14h6" />
      <circle cx="11.5" cy="6" r="2" />
      <circle cx="8.5" cy="14" r="2" />
    </>
  ),
  close: <path d="M5 5l10 10M15 5L5 15" />,
  share: (
    <>
      <path d="M10 12.5V3M6.5 6.5L10 3l3.5 3.5" />
      <path d="M6 9H4.5v8h11V9H14" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`flex-none fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round] ${className}`}
    >
      {paths[name]}
    </svg>
  );
}

/** The app's mark: a manila exhibit tag with its punched hole. */
export function Mark({ className = "size-[26px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" className={className}>
      <path d="M9 6h15v14H9l-6-7z" className="fill-manila" />
      <circle cx="8.5" cy="13" r="1.8" className="fill-paper" />
    </svg>
  );
}
