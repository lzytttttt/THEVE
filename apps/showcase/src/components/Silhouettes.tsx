import { cx } from '@theve/ui';

export function BeastSilhouette({ className }: { className?: string }) {
  return (
    <svg
      className={cx('beast-silhouette', className)}
      viewBox="0 0 1200 280"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="beast-hull" x1="120" y1="60" x2="1080" y2="230" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0a1117" />
          <stop offset="0.5" stopColor="#1b2730" />
          <stop offset="1" stopColor="#070c11" />
        </linearGradient>
        <linearGradient id="beast-rim" x1="600" y1="70" x2="600" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb57a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff7a3d" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="beast-halo" cx="50%" cy="50%" r="50%">
          <stop stopColor="#ff6a4d" stopOpacity="0.24" />
          <stop offset="1" stopColor="#ff6a4d" stopOpacity="0" />
        </radialGradient>
        <filter id="beast-blur">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      <ellipse cx="610" cy="180" rx="530" ry="74" fill="url(#beast-halo)" filter="url(#beast-blur)" opacity="0.9" />
      <g className="beast-silhouette__craft">
        <path
          d="M70 158 254 104 396 96 780 80 1046 108 1170 152 998 176 744 190 392 186 178 176Z"
          fill="url(#beast-hull)"
          stroke="rgba(255,181,133,0.26)"
          strokeWidth="1.2"
        />
        <path
          d="M70 158 178 176 392 186 744 190 998 176 1170 152 1032 196 742 214 388 210 172 188Z"
          fill="#050a0e"
          opacity="0.9"
        />
        <path
          d="M392 96 340 54 470 66 508 88Z M780 80 886 40 992 62 1046 108Z"
          fill="#0b141b"
          stroke="rgba(255,181,133,0.14)"
        />
        <rect x="474" y="40" width="160" height="52" rx="4" fill="#0b131a" stroke="rgba(255,181,133,0.2)" />
        <rect x="718" y="48" width="132" height="42" rx="3" fill="#0a1218" stroke="rgba(255,181,133,0.16)" />
        <rect x="512" y="26" width="36" height="26" fill="#0a1016" stroke="rgba(255,181,133,0.18)" />
        <rect x="794" y="30" width="18" height="58" fill="#091016" />
        <path d="M540 26V10M824 30V6M610 40V16" stroke="rgba(255,181,133,0.35)" strokeWidth="1" />
        <path
          d="M250 104 214 60 300 70 338 96 M1000 112 1068 84 1110 126"
          stroke="rgba(255,181,133,0.22)"
          strokeWidth="1"
        />
        <ellipse cx="610" cy="142" rx="300" ry="54" fill="none" stroke="rgba(99,243,255,0.12)" strokeDasharray="3 8" />
        <ellipse cx="610" cy="142" rx="390" ry="76" fill="none" stroke="rgba(255,181,133,0.1)" strokeDasharray="2 10" />

        {Array.from({ length: 15 }, (_, index) => (
          <rect
            key={`window-${index}`}
            x={300 + index * 42}
            y={index % 2 === 0 ? 126 : 150}
            width={index % 4 === 0 ? 16 : 9}
            height="2.5"
            fill="#ffb547"
            opacity={index % 3 === 0 ? 0.85 : 0.45}
          />
        ))}
        {Array.from({ length: 8 }, (_, index) => (
          <rect
            key={`deck-${index}`}
            x={510 + index * 27}
            y={62}
            width="11"
            height="2"
            fill="#ffb547"
            opacity={0.55}
          />
        ))}
        <path d="M296 158h92M840 168h108M478 178h160" stroke="rgba(255,122,61,0.4)" strokeWidth="1" />
        <path d="M170 176 148 204 232 196 286 184 M1030 176 1064 202 986 198 932 186" fill="#050a0e" />
        <path d="M148 204h84M1064 202h-78" stroke="rgba(255,122,61,0.3)" />
        <g className="beast-silhouette__lights">
          <circle cx="188" cy="172" r="3.2" fill="#ff4d5a" />
          <circle cx="1024" cy="174" r="3.2" fill="#ff4d5a" />
          <circle cx="548" cy="52" r="2.6" fill="#ff4d5a" />
          <circle cx="790" cy="46" r="2.6" fill="#ff4d5a" />
          <circle cx="610" cy="112" r="4" fill="#ff7a3d" opacity="0.8" />
          <circle cx="610" cy="112" r="12" fill="none" stroke="#ff7a3d" opacity="0.28" />
        </g>
      </g>
      <g opacity="0.35">
        <path d="M110 226 214 212 340 220 288 238Z" fill="#1a1418" />
        <path d="M908 232 1012 216 1112 230 1044 248Z" fill="#1a1418" />
      </g>
    </svg>
  );
}

export function JetSilhouette({ className }: { className?: string }) {
  return (
    <svg className={cx('jet-silhouette', className)} viewBox="0 0 80 26" fill="none" aria-hidden="true">
      <path
        d="M3 13 28 10 44 3 56 8 46 12 62 14 72 12 76 14 58 17 38 18 24 24 20 22 26 16 4 15Z"
        fill="currentColor"
      />
      <circle cx="27" cy="13" r="1.4" fill="#ffb547" opacity="0.9" />
    </svg>
  );
}
