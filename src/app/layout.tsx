import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GPW Analiza — rzetelne analizy spółek",
  description:
    "Analizy spółek GPW oparte na raportach i oficjalnych źródłach. Bez kursów i porad inwestycyjnych.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
