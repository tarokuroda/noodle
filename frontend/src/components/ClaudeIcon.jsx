// Claude's spark: uneven rays bursting from a centre point. Drawn as round-capped
// strokes on lucide's 24px grid so it sits beside the other nav icons.
const RAYS = [10, 7.5, 9, 7, 10, 7.5, 9, 7.5];

export default function ClaudeIcon({ size = 24, strokeWidth = 2, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...rest}
    >
      {RAYS.map((len, i) => {
        const a = (i * 2 * Math.PI) / RAYS.length - Math.PI / 2;
        const c = Math.cos(a), s = Math.sin(a);
        const r0 = 2;
        return <line key={i} x1={12 + c * r0} y1={12 + s * r0} x2={12 + c * len} y2={12 + s * len} />;
      })}
    </svg>
  );
}
