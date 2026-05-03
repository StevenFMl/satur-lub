import type { Config } from "tailwindcss";

/**
 * SaturnLub · Sistema visual "Industrial Heavy-Duty"
 *
 * Filosofía:
 *  - Superficies en grises metálicos (acero, asfalto, carbón).
 *  - Acentos de seguridad industrial (amarillo CAT, naranja óxido, azul mecánico).
 *  - Componentes táctiles, pensados para POS / talleres / guantes.
 *  - Bordes duros, sombras secas con offset (tipo "interruptor").
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        /* === Tokens semánticos (driven por CSS variables) === */
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },

        /* === Escalas de marca (acceso directo) === */

        // Acero / asfalto / carbón → superficies y chasis
        steel: {
          50: "#F3F4F5",
          100: "#E2E5E8",
          200: "#C2C7CD",
          300: "#9097A0",
          400: "#5F6772",
          500: "#3F4651",
          600: "#2C323B",
          700: "#202630",
          800: "#161B22",
          900: "#0F141A",
          950: "#080B10",
        },

        // Amarillo seguridad (CAT) → CTA principal, advertencias
        safety: {
          300: "#FFE266",
          400: "#FFD028",
          500: "#FFC107", // tono CAT
          600: "#D69900",
          700: "#A87800",
          800: "#7A5800",
        },

        // Naranja óxido → acentos secundarios, badges de "operativo"
        rust: {
          400: "#F2854B",
          500: "#E85D1A",
          600: "#C24910",
          700: "#92340A",
        },

        // Azul mecánico → estados info / links operativos
        mechanic: {
          400: "#4A8DF7",
          500: "#1F6FEB",
          600: "#1758B8",
          700: "#114289",
        },

        // Rojo de peligro → errores, "stop"
        hazard: {
          500: "#DC2626",
          600: "#B91C1C",
          700: "#7F1D1D",
        },

        // Verde señal → estados OK / running
        signal: {
          500: "#16A34A",
          600: "#15803D",
          700: "#166534",
        },
      },

      // Bordes duros: radio mínimo
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 1px)",
        sm: "2px",
      },

      // Tipografía:
      //  - sans (Inter): texto general, formularios, datos
      //  - display (Bebas Neue): titulares grandes tipo poster automotriz
      //  - mono (JetBrains Mono): IDs, seriales, badges tipo HUD
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "var(--font-display)",
          "Bebas Neue",
          "Impact",
          "ui-sans-serif",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },

      letterSpacing: {
        // Para labels y headers tipo placa industrial
        industrial: "0.12em",
      },

      // Sombras secas, offset, sin blur — sensación de interruptor real
      boxShadow: {
        industrial: "0 3px 0 0 rgba(0,0,0,0.55)",
        "industrial-sm": "0 2px 0 0 rgba(0,0,0,0.55)",
        "industrial-pressed": "0 1px 0 0 rgba(0,0,0,0.55)",
        // Highlight superior tipo metal cepillado
        "industrial-inset": "inset 0 1px 0 0 rgba(255,255,255,0.06)",
        // Bevel completo tipo panel mecanizado: highlight arriba + sombra abajo
        bevel:
          "inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 -1px 0 0 rgba(0,0,0,0.5), 0 4px 0 0 rgba(0,0,0,0.45), 0 8px 18px -6px rgba(0,0,0,0.6)",
        "bevel-sm":
          "inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 -1px 0 0 rgba(0,0,0,0.4), 0 2px 0 0 rgba(0,0,0,0.45)",
        // Para inputs sobre superficies oscuras
        "control-inset":
          "inset 0 1px 2px 0 rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.02)",
        // Brillo amarillo sutil para CTAs (gauge glow)
        "safety-glow":
          "0 0 0 1px rgba(255,193,7,0.15), 0 8px 24px -8px rgba(255,193,7,0.35)",
      },

      // Patrón de barras de hazard para badges/header strips
      backgroundImage: {
        hazard:
          "repeating-linear-gradient(45deg, #FFC107 0 12px, #080B10 12px 24px)",
      },

      keyframes: {
        "press-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "press-blink": "press-blink 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
