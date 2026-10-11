import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(214 20% 88%)",
        input: "hsl(214 20% 84%)",
        ring: "hsl(217 91% 50%)",
        background: "hsl(210 30% 98%)",
        foreground: "hsl(222 47% 14%)",
        muted: { DEFAULT: "hsl(214 25% 95%)", foreground: "hsl(215 16% 40%)" },
        primary: { DEFAULT: "hsl(217 91% 45%)", foreground: "#fff" },
        navy: { DEFAULT: "hsl(222 47% 14%)", soft: "hsl(222 40% 22%)" },
        income: "hsl(152 65% 28%)",
        expense: "hsl(0 72% 42%)",
        warn: "hsl(32 90% 38%)",
      },
      borderRadius: { lg: "0.5rem", md: "0.375rem", sm: "0.25rem" },
    },
  },
  plugins: [],
};
export default config;
