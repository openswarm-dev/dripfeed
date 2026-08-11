import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./narra.css";
import { WalletProvider } from "@/providers/WalletProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Betttr.xyz — Meta Radar",
  description: "Real-time pump.fun meta radar. Track narrative formation, social sparks, and trader psychology.",
  icons: {
    icon: "/logos/Betttr.png",
    apple: "/logos/Betttr.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <link rel="preload" href="/logos/Betttr.png" as="image" type="image/png" />
      </head>
      <body>
        <WalletProvider>
          {children}
        </WalletProvider>
        <div id="dropdown-portal"/>
      </body>
    </html>
  );
}
