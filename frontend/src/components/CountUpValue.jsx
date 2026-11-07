import { useLayoutEffect, useState } from "react";
import { formatNumber } from "../api/client";

const DURATION = 750;

function CountUp({ target, format }) {
  const [current, setCurrent] = useState(0);

  useLayoutEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (motion?.matches || typeof window.requestAnimationFrame !== "function") {
      setCurrent(target);
      return;
    }

    let frame;
    let startedAt;
    function tick(now) {
      startedAt ??= now;
      const progress = Math.min((now - startedAt) / DURATION, 1);
      setCurrent(progress === 1 ? target : target * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    }
    function finishIfReduced(event) {
      if (!event.matches) return;
      window.cancelAnimationFrame(frame);
      setCurrent(target);
    }

    frame = window.requestAnimationFrame(tick);
    motion?.addEventListener?.("change", finishIfReduced);
    return () => {
      window.cancelAnimationFrame(frame);
      motion?.removeEventListener?.("change", finishIfReduced);
    };
  }, [target]);

  return format(current);
}

export default function CountUpValue({ as: Tag = "span", className, value, format = formatNumber }) {
  const target = Number(value);
  return (
    <Tag className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {Number.isFinite(target) && target !== 0
        ? <CountUp key={target} target={target} format={format} />
        : format(value)}
    </Tag>
  );
}
