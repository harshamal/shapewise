import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-inter", display: "swap" });
const sinhala = Noto_Sans_Sinhala({ subsets: ["sinhala"], weight: ["400", "500"], variable: "--font-sinhala", display: "swap" });
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], weight: ["400", "500"], variable: "--font-tamil", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Shapewise", template: "%s · Shapewise" },
  description: "Business software that takes the shape of your factory.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sinhala.variable} ${tamil.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
