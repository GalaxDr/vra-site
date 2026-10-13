import type { Metadata } from "next";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar VRA · Sensor de vazão de adubo por radar Doppler",
  description:
    "Sensor não invasivo de vazão de fertilizante granulado para semeadoras, com radar Doppler de 24 GHz e ESP32-S3. Simulação interativa da aplicação a taxa variável.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
