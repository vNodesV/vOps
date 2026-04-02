interface SpinnerProps {
  /** Size in pixels. Defaults to 24. */
  size?: number;
  /** Optional label for screen readers. */
  label?: string;
}

export default function Spinner({ size = 24, label = 'Loading' }: SpinnerProps) {
  return (
    <div className="flex items-center justify-center p-4" role="status" aria-label={label}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--vn-border)"
          strokeWidth="3"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="var(--vn-primary)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
