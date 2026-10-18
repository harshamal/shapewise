import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Shapewise", template: "%s · Shapewise" },
  description: "Business software that takes the shape of your factory.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh max-w-full overflow-x-hidden">{children}</body>
    </html>
  );
}
