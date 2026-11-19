import * as React from "react";
import { clsx } from "clsx";

// The app's only checkbox (FLOW-245): a small round check. It is a native
// <input type="checkbox"> restyled in CSS, so labels, the Space key, forms and
// screen readers work as before. `indeterminate` shows a dash (e.g. "select all"
// with some rows selected). tests/round-check.test.tsx fails on raw checkboxes.
export type RoundCheckProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  indeterminate?: boolean;
};
export const RoundCheck = React.forwardRef<HTMLInputElement, RoundCheckProps>(
  ({ indeterminate = false, className, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate;
    }, [indeterminate]);
    return <input {...props} ref={inner} type="checkbox" className={clsx("round-check", className)} />;
  },
);
RoundCheck.displayName = "RoundCheck";
