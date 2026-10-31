import type { OverlapScores } from '../lib/types';

const AXES: { key: keyof OverlapScores; label: string }[] = [
  { key: 'market', label: 'Shared market' },
  { key: 'content', label: 'Content' },
  { key: 'product', label: 'Product' },
  { key: 'threat', label: 'Threat' },
];

function polar(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

export function OverlapRadar({
  scores,
  size = 320,
  showLabels = true,
  label,
}: {
  scores: OverlapScores;
  size?: number;
  showLabels?: boolean;
  label: string;
}) {
  // Extra canvas pad so axis labels (esp. left/right) aren't clipped by the SVG viewBox edge.
  const pad = showLabels ? Math.round(size * 0.18) : Math.round(size * 0.04);
  const vb = size + pad * 2;
  const cx = vb / 2;
  const cy = vb / 2;
  const maxR = size * 0.34;
  const n = AXES.length;
  const labelR = maxR + size * 0.14;

  const ringPolys = [0.33, 0.66, 1].map((f) =>
    AXES.map((_, i) => polar(cx, cy, maxR * f, i, n).join(',')).join(' '),
  );

  const valuePts = AXES.map((axis, i) => {
    const v = Math.max(0, Math.min(100, scores[axis.key])) / 100;
    return polar(cx, cy, maxR * v, i, n).join(',');
  }).join(' ');

  return (
    <svg
      viewBox={`0 0 ${vb} ${vb}`}
      role="img"
      aria-label={`Overlap radar for ${label}`}
      className="overlap-radar"
      overflow="visible"
    >
      {ringPolys.map((pts) => (
        <polygon key={pts} points={pts} fill="none" stroke="var(--border)" />
      ))}
      {AXES.map((axis, i) => {
        const [x, y] = polar(cx, cy, maxR, i, n);
        return <line key={axis.key} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon points={valuePts} fill="rgba(63,199,224,0.22)" stroke="var(--accent)" strokeWidth="2" />
      {AXES.map((axis, i) => {
        const v = Math.max(0, Math.min(100, scores[axis.key])) / 100;
        const [x, y] = polar(cx, cy, maxR * v, i, n);
        return <circle key={`pt-${axis.key}`} cx={x} cy={y} r="3.5" fill="var(--accent)" />;
      })}
      {showLabels &&
        AXES.map((axis, i) => {
          const [lx, ly] = polar(cx, cy, labelR, i, n);
          // Anchor left/right labels toward the chart so long words stay inside the pad.
          const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const cos = Math.cos(angle);
          let anchor: 'start' | 'middle' | 'end' = 'middle';
          if (cos > 0.35) anchor = 'start';
          else if (cos < -0.35) anchor = 'end';
          return (
            <text
              key={`lbl-${axis.key}`}
              x={lx}
              y={ly}
              fill="var(--muted, #8B95A5)"
              fontSize={size < 200 ? 9 : 11}
              textAnchor={anchor}
              dominantBaseline="middle"
            >
              {axis.label}
            </text>
          );
        })}
    </svg>
  );
}

export { AXES as OVERLAP_AXES };
