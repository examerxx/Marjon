// Иконки KDS: собственный набор вместо библиотеки.
//
// Причина не в экономии байт, а в едином рисунке: толщина штриха 1.6 и
// скруглённые концы читаются на кухонном мониторе с трёх метров и не
// выглядят «стандартным набором иконок», по которому сразу видно шаблон.
// Размер задаётся через width/height, цвет — currentColor.

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

function Svg({ size = 20, children, className }) {
  return (
    <svg {...BASE} width={size} height={size} className={className}>
      {children}
    </svg>
  );
}

export function IconSound({ size }) {
  return (
    <Svg size={size}>
      <path d="M4 9.5h3L11.5 6v12L7 14.5H4z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
    </Svg>
  );
}

export function IconSoundOff({ size }) {
  return (
    <Svg size={size}>
      <path d="M4 9.5h3L11.5 6v12L7 14.5H4z" />
      <path d="m16 9.5 4.5 5M20.5 9.5l-4.5 5" />
    </Svg>
  );
}

export function IconRefresh({ size }) {
  return (
    <Svg size={size}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V9h-4.5" />
    </Svg>
  );
}

export function IconExpand({ size }) {
  return (
    <Svg size={size}>
      <path d="M9.5 4.5H4.5v5M14.5 4.5h5v5M9.5 19.5h-5v-5M14.5 19.5h5v-5" />
    </Svg>
  );
}

export function IconLogout({ size }) {
  return (
    <Svg size={size}>
      <path d="M13.5 5H6.8A1.8 1.8 0 0 0 5 6.8v10.4A1.8 1.8 0 0 0 6.8 19h6.7" />
      <path d="M17 8.5 20.5 12 17 15.5" />
      <path d="M10 12h10.2" />
    </Svg>
  );
}

export function IconCheck({ size }) {
  return (
    <Svg size={size}>
      <path d="m4.8 12.6 4.4 4.4L19.4 6.8" />
    </Svg>
  );
}

export function IconArrow({ size }) {
  return (
    <Svg size={size}>
      <path d="M4.5 12h14" />
      <path d="m13.5 7 5 5-5 5" />
    </Svg>
  );
}

export function IconBack({ size }) {
  return (
    <Svg size={size}>
      <path d="M19.5 12h-14" />
      <path d="m10.5 7-5 5 5 5" />
    </Svg>
  );
}

export function IconEye({ size }) {
  return (
    <Svg size={size}>
      <path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconEyeOff({ size }) {
  return (
    <Svg size={size}>
      <path d="M4 4.5 20 19.5" />
      <path d="M9.9 6.3A9.7 9.7 0 0 1 12 6c5.6 0 9.2 6 9.2 6a17 17 0 0 1-3.2 3.9" />
      <path d="M6.4 8.1A17.4 17.4 0 0 0 2.8 12s3.6 6 9.2 6a9.8 9.8 0 0 0 3.5-.7" />
    </Svg>
  );
}

export function IconUndo({ size }) {
  return (
    <Svg size={size}>
      <path d="M5.5 9.5h8.7a4.8 4.8 0 0 1 0 9.6H8.5" />
      <path d="m9.5 5.5-4 4 4 4" />
    </Svg>
  );
}

export function IconTv({ size }) {
  return (
    <Svg size={size}>
      <rect x="3.5" y="6.2" width="17" height="11.6" rx="2.2" />
      <path d="M9.2 20.4h5.6" />
      <path d="M12 17.8v2.6" />
    </Svg>
  );
}

export function IconWifi({ size }) {
  return (
    <Svg size={size}>
      <path d="M2.6 8.4a14.5 14.5 0 0 1 18.8 0" />
      <path d="M6.1 12.1a9.6 9.6 0 0 1 11.8 0" />
      <path d="M9.5 15.8a4.9 4.9 0 0 1 5 0" />
      <path d="M12 19.2h.01" strokeWidth="2.4" />
    </Svg>
  );
}

export function IconWifiOff({ size }) {
  return (
    <Svg size={size}>
      <path d="M2.6 8.4a14.5 14.5 0 0 1 5.2-3" />
      <path d="M12.4 5a14.4 14.4 0 0 1 9 3.4" />
      <path d="M6.1 12.1a9.6 9.6 0 0 1 3.4-1.7" />
      <path d="M14.4 10.7a9.6 9.6 0 0 1 3.5 1.4" />
      <path d="M9.5 15.8a4.9 4.9 0 0 1 5 0" />
      <path d="M12 19.2h.01" strokeWidth="2.4" />
      <path d="M3.5 3.5l17 17" />
    </Svg>
  );
}

export function IconClock({ size }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.1 2" />
    </Svg>
  );
}

export function IconAlert({ size }) {
  return (
    <Svg size={size}>
      <path d="M12 4.4 21 19.6H3z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.1h.01" strokeWidth="2.4" />
    </Svg>
  );
}

export function IconBackspace({ size }) {
  return (
    <Svg size={size}>
      <path d="M9.4 6h9.1A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5H9.4L4 12z" />
      <path d="m12.4 9.6 4.8 4.8M17.2 9.6l-4.8 4.8" />
    </Svg>
  );
}

export function IconSpinner({ size, className }) {
  return (
    <svg
      {...BASE}
      width={size || 18}
      height={size || 18}
      className={`icon-spin ${className || ""}`.trim()}
    >
      <circle cx="12" cy="12" r="8" strokeOpacity="0.25" />
      <path d="M20 12a8 8 0 0 0-8-8" />
    </svg>
  );
}
