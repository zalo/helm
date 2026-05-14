/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — differentiated by lightness, not shadow.
        bg: {
          0: "#0d1117", // app canvas
          1: "#161b22", // panel
          2: "#21262d", // raised / header
          3: "#2d333b", // hover / active
        },
        border: {
          DEFAULT: "#30363d",
          strong: "#444c56",
        },
        fg: {
          DEFAULT: "#e6edf3", // primary text
          muted: "#8b949e", // secondary text
          faint: "#6e7681", // tertiary / disabled
        },
        // P&L semantics — pair with sign/▲▼ cues, never color alone.
        gain: { DEFAULT: "#3fb950", dim: "#1f3d28" },
        loss: { DEFAULT: "#f85149", dim: "#3d1f1f" },
        accent: { DEFAULT: "#58a6ff", dim: "#1f3251" },
        warn: { DEFAULT: "#d29922", dim: "#3d3320" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
        xs: ["11px", "16px"],
        sm: ["12px", "17px"],
        base: ["13px", "19px"],
      },
      spacing: {
        // 4px base unit — tight financial density.
        0.5: "2px",
        1.5: "6px",
        2.5: "10px",
      },
    },
  },
  plugins: [],
};
