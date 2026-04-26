import type { Metadata } from 'next';
import { Patrick_Hand, Caveat, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const hand = Patrick_Hand({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-hand',
});

const handBold = Caveat({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-hand-bold',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Players · Guess the player of the day',
  description:
    'Daily Wordle-style guessing game with football players. Each guess places a pin on the pitch.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hand.variable} ${handBold.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
