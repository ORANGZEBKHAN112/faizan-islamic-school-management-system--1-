export const DEV_NAME = 'Orangzaib Khan Baloch';

interface DevCreditProps {
  className?: string;
  compact?: boolean;
}

export default function DevCredit({ className = '', compact = false }: DevCreditProps) {
  return (
    <footer
      className={`app-dev-credit ${compact ? 'app-dev-credit-compact' : ''} ${className}`.trim()}
      aria-label={`Developed by ${DEV_NAME}`}
    >
      <span>
        Developed by <strong>{DEV_NAME}</strong>
      </span>
      {!compact && (
        <>
          <span className="app-dev-credit-dot" aria-hidden="true">
            ·
          </span>
          <span>Faizan Islamic School System</span>
        </>
      )}
    </footer>
  );
}
