import { useLayoutEffect, useRef, useState } from 'react'

export default function OrderTypeTabs({ children, label }) {
  const rootRef = useRef(null)
  const [pill, setPill] = useState(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const active = root.querySelector('button[aria-pressed="true"]')
      if (!active) return
      const next = { left: active.offsetLeft, width: active.offsetWidth, top: active.offsetTop, height: active.offsetHeight }
      setPill(current => current && Object.keys(next).every(key => current[key] === next[key]) ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    root.querySelectorAll('button').forEach(button => observer.observe(button))
    return () => observer.disconnect()
  }, [children])
  return <div ref={rootRef} className="hall-types hall-types--top hall-types--segmented" role="group" aria-label={label}>
    <span className="hall-types__indicator" aria-hidden="true" style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width, top: pill.top, height: pill.height } : { opacity: 0 }} />
    {children}
  </div>
}
