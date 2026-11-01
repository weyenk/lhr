import type { ReactNode } from 'react';

export interface DecisionAction {
  label: string;
  /** Overrides the accessible name when several rows share the same label. */
  ariaLabel?: string;
  onClick: () => void;
}

interface DecisionRowProps {
  title: ReactNode;
  meta?: ReactNode;
  primary: DecisionAction;
  secondary?: DecisionAction;
}

export function DecisionRow({ title, meta, primary, secondary }: DecisionRowProps) {
  return (
    <li className="decision-row">
      <div className="decision-row-body">
        <span className="decision-row-title">{title}</span>
        {meta && <span className="decision-row-meta">{meta}</span>}
      </div>
      <div className="decision-row-actions">
        <button type="button" aria-label={primary.ariaLabel} onClick={primary.onClick}>
          {primary.label}
        </button>
        {secondary && (
          <button type="button" aria-label={secondary.ariaLabel} onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </li>
  );
}
