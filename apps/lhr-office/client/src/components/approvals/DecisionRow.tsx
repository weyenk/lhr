import type { ReactNode } from 'react';

export type DecisionTone = 'approve' | 'reject';

export interface DecisionAction {
  label: string;
  /** Overrides the accessible name when several rows share the same label. */
  ariaLabel?: string;
  onClick: () => void;
  tone?: DecisionTone;
}

export interface DecisionLink {
  label: string;
  href: string;
  ariaLabel?: string;
}

interface DecisionRowProps {
  title: ReactNode;
  meta?: ReactNode;
  /** Optional outbound link rendered as a button among the row actions. */
  link?: DecisionLink;
  primary: DecisionAction;
  secondary?: DecisionAction;
}

function toneClass(tone?: DecisionTone): string | undefined {
  if (tone === 'approve') return 'decision-action-approve';
  if (tone === 'reject') return 'decision-action-reject';
  return undefined;
}

export function DecisionRow({ title, meta, link, primary, secondary }: DecisionRowProps) {
  return (
    <li className="decision-row">
      <div className="decision-row-body">
        <span className="decision-row-title">{title}</span>
        {meta && <span className="decision-row-meta">{meta}</span>}
      </div>
      <div className="decision-row-actions">
        {link && (
          <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.ariaLabel} className="decision-action-link">
            {link.label}
          </a>
        )}
        <button type="button" className={toneClass(primary.tone)} aria-label={primary.ariaLabel} onClick={primary.onClick}>
          {primary.label}
        </button>
        {secondary && (
          <button type="button" className={toneClass(secondary.tone)} aria-label={secondary.ariaLabel} onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </li>
  );
}
