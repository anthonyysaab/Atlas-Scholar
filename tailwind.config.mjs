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
        accent: "var(--accent)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        "anno-yellow": "var(--anno-yellow)",
        "anno-green": "var(--anno-green)",
        "anno-blue": "var(--anno-blue)",
        "anno-pink": "var(--anno-pink)"
      }
    }
  },
  plugins: []
};
