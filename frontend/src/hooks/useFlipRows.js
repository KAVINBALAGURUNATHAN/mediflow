import { useLayoutEffect, useRef } from "react";

// Classic FLIP reorder animation for a list of DOM rows keyed by `getKey`.
// Call with a ref to the container (e.g. <tbody>) and the array driving the
// list - whenever an item's row changes vertical position between renders,
// it animates from its old spot to its new one instead of teleporting.
// Transform-only (GPU-accelerated per AUDIT.md Category 5), and since it's
// a *transition* retargeted every render (not a fixed-duration keyframe),
// rapid consecutive reorders stay interruptible per AUDIT.md Category 4.
export default function useFlipRows(containerRef, items, getKey) {
  const positions = useRef(new Map());

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const rows = containerRef.current.querySelectorAll("[data-flip-key]");
    const newPositions = new Map();
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    rows.forEach((row) => {
      const key = row.getAttribute("data-flip-key");
      const rect = row.getBoundingClientRect();
      newPositions.set(key, rect.top);

      const prevTop = positions.current.get(key);
      if (prevTop !== undefined && prevTop !== rect.top) {
        const delta = prevTop - rect.top;

        if (prefersReducedMotion) {
          // Functional reorder still needs to happen, just without the
          // animated transition - jump straight to the final position.
          return;
        }

        row.style.transform = `translateY(${delta}px)`;
        row.style.transition = "none";
        // Force layout before removing the transform so the browser has a
        // committed "invert" state to animate away from.
        row.getBoundingClientRect();
        requestAnimationFrame(() => {
          row.style.transition = "transform 250ms var(--ease-out)";
          row.style.transform = "";
        });
      }
    });

    positions.current = newPositions;
  }, [items, getKey, containerRef]);
}
