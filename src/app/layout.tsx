import type { Metadata } from "next";
import { Inter, Bebas_Neue, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const bebas = Bebas_Neue({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "SaturnLub · Sistema operativo para talleres",
    template: "%s · SaturnLub",
  },
  description:
    "Plataforma para lubricentros, talleres mecánicos y ferreterías. Órdenes, vehículos, inventario y facturación.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${bebas.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
