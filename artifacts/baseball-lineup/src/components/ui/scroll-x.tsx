import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Horizontal scroll container with a right-edge fade overlay so users
 * (especially on phones, where wide tables silently get clipped at the
 * viewport edge) can see at a glance that there's more content scrolled
 * off to the right. The fade hides itself once the user has scrolled to
 * the end.
 *
 * Use anywhere you'd otherwise wrap a wide table in
 * `<div className="overflow-x-auto">`.
 */
export const ScrollX = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const [atEnd, setAtEnd] = React.useState(true);
  const [hasOverflow, setHasOverflow] = React.useState(false);

  React.useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  React.useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    let raf = 0;
    // Defensive: ResizeObserver callbacks can fire synchronously while
    // React is still committing layout, and if a state update from one
    // callback ever triggered a layout change that re-fired the
    // observer we'd get the dreaded "ResizeObserver loop limit
    // exceeded" warning + a visible flicker. We coalesce all reads and
    // state writes into the next animation frame so React batches them
    // outside the observer's callback.
    const update = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const node = innerRef.current;
        if (!node) return;
        const overflow = node.scrollWidth > node.clientWidth + 1;
        const ended =
          !overflow ||
          node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
        // Functional setState with a same-value bail-out so identical
        // measurements don't queue a re-render — important since this
        // can fire on every scroll tick and on every parent resize.
        setHasOverflow((prev) => (prev === overflow ? prev : overflow));
        setAtEnd((prev) => (prev === ended ? prev : ended));
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={innerRef}
        className={cn("overflow-x-auto overscroll-x-contain", className)}
        {...props}
      >
        {children}
      </div>
      {hasOverflow && !atEnd && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
        />
      )}
    </div>
  );
});
ScrollX.displayName = "ScrollX";
