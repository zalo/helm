/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // OpenBB-style flat dark surfaces — near-black, slightly cool gray.
        bg: {
          0: "#151518", // app canvas
          1: "#1b1b1f", // panel surface
          2: "#212126", // raised / header
          3: "#2b2b31", // hover / active
        },
        border: {
          DEFAULT: "#323237",
          strong: "#444448",
        },
        fg: {
          DEFAULT: "#ffffff",  // primary text
          muted: "#9a9aa2",    // secondary
          faint: "#6a6a72",    // tertiary / disabled
        },
        // P&L semantics — green/red, the only colors besides the orange accent.
        gain:   { DEFAULT: "#25c685", dim: "#0e2a1d" },
        loss:   { DEFAULT: "#f0455a", dim: "#2e1115" },
        // OpenBB signature orange — the single loud accent.
        accent: { DEFAULT: "#ff8000", dim: "#2e1c08" },
        warn:   { DEFAULT: "#f0a020", dim: "#2e2410" },
      },
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "monospace"],
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
        "glow":    "0 0 14px rgba(255, 128, 0, 0.20)",
        "glow-sm": "0 0 8px rgba(255, 128, 0, 0.15)",
        "panel":   "0 8px 32px rgba(0, 0, 0, 0.55)",
        "copilot": "-8px 0 32px rgba(0, 0, 0, 0.45)",
      },
      keyframes: {
        "radar-ping": {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "75%, 100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)", opacity: "0" },
          to:   { transform: "translateX(0)", opacity: "1" },
        },
        "fade-up": {
          from: { transform: "translateY(6px)", opacity: "0" },
          to:   { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "radar":          "radar-ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
        "slide-in-right": "slide-in-right 0.22s cubic-bezier(0.16,1,0.3,1)",
        "fade-up":        "fade-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
