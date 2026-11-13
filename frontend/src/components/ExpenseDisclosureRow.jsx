import { Children, cloneElement, useEffect, useState } from "react";

// Keep rows mounted through both transition directions. Grid tracks interpolate
// content height without measuring the whole table on every animation frame.
export function ExpenseDisclosureRow({ visible, children, className = "" }) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    let frame;
    let nextFrame;
    let timer;
    if (visible) {
      setPresent(true);
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => setExpanded(true));
      });
    } else {
      setExpanded(false);
      timer = setTimeout(() => setPresent(false), 280);
    }
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); clearTimeout(timer); };
  }, [visible]);
  if (!present) return null;
  return (
    <tr hidden={!present} aria-hidden={!visible} inert={!visible ? true : undefined}
      className={`${className} wh-expense-reveal${expanded ? " is-open" : ""}`}>
      {Children.map(children, (cell) => cloneElement(cell, {},
        <div className="wh-expense-reveal__track"><div className="wh-expense-reveal__clip">
          <div className="wh-expense-reveal__content">{cell.props.children}</div>
        </div></div>,
      ))}
    </tr>
  );
}

