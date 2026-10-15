/** App mark: a ring with a satellite dot, for a model that runs on this machine. */
export default function Logo({ size = 22, className = "" }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="13" r="7" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="18.2" cy="5.8" r="2.8" fill="currentColor" />
    </svg>
  );
}
