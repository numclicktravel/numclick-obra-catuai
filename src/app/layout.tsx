import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cronograma de Obra — NUM CLICK VIAGENS | Shopping Catuaí",
  description:
    "Cronograma de Obras Interativo (Gráfico de Gantt Horizontal) para reforma/adequação da loja NUM CLICK VIAGENS no Shopping Catuaí.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
