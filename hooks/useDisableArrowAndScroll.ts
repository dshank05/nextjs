import { useEffect } from "react";

export function useDisableArrowAndScroll() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Disable arrow keys globally for scroll
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const target = event.target as HTMLElement;
        // If focus is on input/textarea, prevent default
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA"
        ) {
          event.preventDefault();
        }
        // Prevent scrolling even if not on input/textarea
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
