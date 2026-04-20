import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Players Game",
  description: "Wordle-style guessing game with football players.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
