import { useAuth } from '../context/AuthContext.jsx';

function initials(name) {
  const clean = String(name || '').replace(/[^a-z0-9 ]/gi, '').trim() || '?';
  const parts = clean.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

export default function Avatar({ name, src, size = 40, className = '' }) {
  const { user } = useAuth();
  const label = name || user?.username || '?';
  const initialsText = initials(label);
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: `${Math.round(size * 0.42)}px`
      }}
      title={label}
      aria-label={label}
      role="img"
    >
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span className="avatar-initials">{initialsText}</span>
      )}
    </span>
  );
}