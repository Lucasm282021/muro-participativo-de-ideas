import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muro común — Ideas que hacen lugar",
  description:
    "Un espacio simple para escuchar, construir ideas juntos y ver cómo una conversación se transforma en algo más.",
  icons: {
    icon: [{ url: "/muro-mark.svg", type: "image/svg+xml" }],
    apple: "/muro-mark.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
