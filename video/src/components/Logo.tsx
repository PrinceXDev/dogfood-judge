import { C, fonts } from "../lib/theme";

// The product's mark (src/frontend/components/logo.tsx): a dog tag with a bite
// out of its corner, carrying a judge → review → result check path.
const BITE = [
  { cx: 25.6, cy: 3.1, r: 3.3 },
  { cx: 29.2, cy: 6.4, r: 3.3 },
  { cx: 29.9, cy: 11.3, r: 3.1 },
];

export const LogoMark: React.FC<{ size?: number; draw?: number; id?: string }> = ({
  size = 64,
  draw = 1,
  id = "logo",
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <defs>
      <mask id={`bite-${id}`}>
        <rect width="32" height="32" fill="#fff" />
        {BITE.map((c) => (
          <circle key={c.cy} {...c} fill="#000" />
        ))}
        <circle cx="11" cy="7.4" r="1.7" fill="#000" />
      </mask>
    </defs>
    <rect x="4" y="2" width="24" height="28" rx="7.5" fill={C.accent} mask={`url(#bite-${id})`} />
    <path
      d="M10 18.6 L14.3 22.6 L22 13.6"
      fill="none"
      stroke={C.bg}
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - draw}
    />
    {[
      [10, 18.6],
      [14.3, 22.6],
      [22, 13.6],
    ].map(([cx, cy], i) => (
      <circle key={cx} cx={cx} cy={cy} r={1.9 * Math.min(1, Math.max(0, draw * 3 - i))} fill={C.bg} />
    ))}
  </svg>
);

export const Wordmark: React.FC<{ scale?: number }> = ({ scale = 1 }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 14 * scale }}>
    <span
      style={{
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 64 * scale,
        letterSpacing: "-0.04em",
        color: C.ink,
      }}
    >
      dogfood
    </span>
    <span
      style={{
        fontFamily: fonts.mono,
        fontWeight: 500,
        fontSize: 22 * scale,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: C.ink2,
        border: `${1.5 * scale}px solid ${C.lineStrong}`,
        borderRadius: 7 * scale,
        padding: `${3 * scale}px ${10 * scale}px`,
      }}
    >
      judge
    </span>
  </span>
);
