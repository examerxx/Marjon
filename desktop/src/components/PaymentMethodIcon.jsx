/** Consistent, optically sized duotone payment illustrations. */
export default function PaymentMethodIcon({ type }) {
  const colors = {
    cash: ['#d6eae2', '#246052'],
    card: ['#dce8f4', '#315a80'],
    vip: ['#f3e6c6', '#8b6a2c'],
    debt: ['#e3e2ef', '#5c587e'],
  }
  const [face, ink] = colors[type] || colors.cash
  return <svg className="payment-method-art" width="36" height="36" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <g stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {type === 'cash' && <>
        <path d="M7 7H26C27.1 7 28 7.9 28 9V22" strokeOpacity=".55"/>
        <rect x="3" y="10" width="25" height="17" rx="3" fill={face}/>
        <path d="M10 13H21C21 15 22 16 25 16V21C22 21 21 22 21 24H10C10 22 9 21 6 21V16C9 16 10 15 10 13Z" fill="white" fillOpacity=".6" strokeWidth="1"/>
        <ellipse cx="15.5" cy="18.5" rx="3.5" ry="4.5" fill={face}/>
        <path d="M15.5 16.5V20.5M9 18.5H10M21 18.5H22" strokeWidth="1.3"/>
      </>}
      {type === 'card' && <>
        <rect x="3" y="6" width="26" height="21" rx="4" fill={face}/>
        <path d="M4 12H28" strokeWidth="3.5"/>
        <rect x="7" y="17" width="7" height="5" rx="1.2" fill="white" fillOpacity=".8" strokeWidth="1.1"/>
        <path d="M10.5 17V22M7 19.5H14" strokeWidth=".8"/>
        <path d="M23 17C25 18.3 25 20.7 23 22M20.5 18.5C21.4 19.1 21.4 19.9 20.5 20.5" strokeWidth="1.3"/>
        <path d="M7 24H16" strokeWidth="1.2"/>
      </>}
      {type === 'vip' && <>
        <path d="M4 10L10.5 15.5L16 6L21.5 15.5L28 10L25 24H7L4 10Z" fill={face}/>
        <path d="M9 20L7.5 14M23 20L24.5 14" stroke="white" strokeWidth="1.6"/>
        <path d="M16 13L19 17L16 21L13 17L16 13Z" fill="white" fillOpacity=".85" strokeWidth="1.1"/>
        <rect x="7" y="24" width="18" height="4" rx="1.5" fill={face}/>
      </>}
      {type === 'debt' && <>
        <path d="M7 10V6H24V11" fill={face}/>
        <path d="M11 8H20" strokeWidth="1"/>
        <rect x="3" y="10" width="25" height="18" rx="4" fill={face}/>
        <path d="M7 14H23" stroke="white" strokeOpacity=".8"/>
        <path d="M23 16H29V23H23C21 23 20 21.8 20 19.5C20 17.2 21 16 23 16Z" fill="white" fillOpacity=".9"/>
        <circle cx="24" cy="19.5" r="1.2" fill={ink} stroke="none"/>
        <path d="M7 24H15" strokeWidth="1.2"/>
      </>}
    </g>
  </svg>
}
