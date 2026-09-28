const ICONS = {
  lock: (
    <path d="M5 10h14v10H5zM8 10V7a4 4 0 0 1 8 0v3" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  settings: (
    <path d="M12 3l1.3 2.7 2.9.6-2 2.1.5 2.9L12 10.2 9.3 11.3l.5-2.9-2-2.1 2.9-.6zM6 15l1 1.9 2 .5-1.4 1.5.3 2L6 20l-1.9-1.1.3-2L3 15.4l2-.5zM18 15l.3 2 2 .4-1.4 1.5.3 2L18 20l-1.2 1-.3-2-2.1-.5 1.4-1.5-.3-2z" />
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  sun: (
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  ),
  send: <path d="M4 12h14M12 5l7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  back: <path d="M15 5l-7 7 7 7" />,
  logoff: <path d="M14 4h-6v16h6M9 12h10M17 9l3 3-3 3" />
};

export default function Icon({ name, size = 20, strokeWidth = 1.8, className = '', ...rest }) {
  return (
    <svg
      className={`icon icon-${name} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}