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
    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 1;
      setHasOverflow(overflow);
      setAtEnd(
        !overflow ||
          el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
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
