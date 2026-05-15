/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep midnight blue-black surfaces — differentiated by lightness.
        bg: {
          0: "#020c18", // abyss — app canvas
          1: "#06121f", // panel surface
          2: "#0b1a2a", // raised / header
          3: "#112133", // hover / active
        },
        border: {
          DEFAULT: "#152a42",
          strong: "#1e3d5e",
        },
        fg: {
          DEFAULT: "#dde9f8",  // primary text, blue-tinted white
          muted: "#6d8daa",    // secondary
          faint: "#3a5570",    // tertiary / disabled
        },
        // P&L semantics — vivid on dark blue backgrounds.
        gain:   { DEFAULT: "#20d47c", dim: "#051a11" },
        loss:   { DEFAULT: "#f0495a", dim: "#1f060a" },
        accent: { DEFAULT: "#06d1f3", dim: "#021822" },
        warn:   { DEFAULT: "#f0a020", dim: "#1e1200" },
      },
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        display: ["Syne", '"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
        xs:    ["11px", "16px"],
        sm:    ["12px", "17px"],
        base:  ["13px", "19px"],
      },
      spacing: {
        0.5: "2px",
        1.5: "6px",
        2.5: "10px",
      },
      boxShadow: {
        "glow":      "0 0 16px rgba(6, 209, 243, 0.25)",
        "glow-sm":   "0 0 8px rgba(6, 209, 243, 0.18)",
        "glow-gain": "0 0 12px rgba(32, 212, 124, 0.25)",
        "glow-loss": "0 0 12px rgba(240, 73, 90, 0.25)",
        "panel":     "0 4px 32px rgba(2, 12, 24, 0.6)",
      },
      animation: {
        "radar": "radar-ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
      },
      keyframes: {
        "radar-ping": {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "75%, 100%": { transform: "scale(2.2)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
