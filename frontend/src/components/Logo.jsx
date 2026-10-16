export default function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M13 17 C 10 13, 16 11, 13 7 S 15 2, 13 1" fill="none" stroke="#FFC94A" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M20 17 C 17 13, 23 11, 20 7 S 22 2, 20 1" fill="none" stroke="#FFC94A" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M27 17 C 24 13, 30 11, 27 7 S 29 2, 27 1" fill="none" stroke="#FFC94A" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M31 2 L 22 19" stroke="#1E2235" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 18 h32 a16 16 0 0 1 -32 0 z" fill="#4F5BD5" />
      <path d="M9 24 Q 14 21 20 24 T 31 24" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
