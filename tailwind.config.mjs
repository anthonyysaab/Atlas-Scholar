/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "bg-subtle": "var(--bg-subtle)",
        panel: "var(--panel)",
        border: "var(--border)",
        text: "var(--text)",
        "text-weak": "var(--text-weak)",
        // Themes set --accent as a hex string, so opacity modifiers (bg-accent/15) mix with transparent.
        accent: ({ opacityValue }) =>
          opacityValue === undefined || opacityValue === "1"
            ? "var(--accent)"
            : `color-mix(in srgb, var(--accent) calc(${opacityValue} * 100%), transparent)`,
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        "anno-yellow": "var(--anno-yellow)",
        "anno-green": "var(--anno-green)",
        "anno-blue": "var(--anno-blue)",
        "anno-pink": "var(--anno-pink)"
      },
      transitionTimingFunction: {
        "out-soft": "var(--ease-out)"
      },
      animation: {
        "fade-in": "ra-fade-in var(--dur-med) var(--ease-out) both",
        "fade-out": "ra-fade-out var(--dur-fast) var(--ease-out) both",
        "pop-in": "ra-pop-in var(--dur-med) var(--ease-out) both",
        "pop-out": "ra-pop-out var(--dur-fast) var(--ease-out) both",
        "toast-in": "ra-toast-in var(--dur-med) var(--ease-out) both",
        "slide-in-left": "ra-slide-in-left var(--dur-med) var(--ease-out) both",
        "slide-in-right": "ra-slide-in-right var(--dur-med) var(--ease-out) both"
      }
    }
  },
  plugins: []
};
