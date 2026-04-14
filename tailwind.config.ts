import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#10141d",
        paper: "#f6f1e8",
        ember: "#d96d3a",
        sage: "#8aa08f",
        ocean: "#204a60",
        mist: "#d9e3e8",
      },
      boxShadow: {
        panel: "0 24px 80px rgba(12, 16, 24, 0.12)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(rgba(16,20,29,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,20,29,0.04) 1px, transparent 1px)",
      },
      fontFamily: {
        sans: ['"Space Grotesk Variable"', '"Avenir Next"', "sans-serif"],
        display: ['"Fraunces"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
