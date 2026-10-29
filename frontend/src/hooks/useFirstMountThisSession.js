import { useRef } from "react";

// SessionStorage-backed: true the first time `key` is seen in this browser
// tab's session, false on every subsequent mount (route navigation back to
// the same page, HMR, etc.) - so entrance animations play once, not on
// every visit to a page the user opens dozens of times a day.
export default function useFirstMountThisSession(key) {
  const ref = useRef(null);
  if (ref.current === null) {
    const storageKey = `qc-animated:${key}`;
    const alreadyPlayed = sessionStorage.getItem(storageKey) === "1";
    ref.current = !alreadyPlayed;
    if (!alreadyPlayed) {
      sessionStorage.setItem(storageKey, "1");
    }
  }
  return ref.current;
}
