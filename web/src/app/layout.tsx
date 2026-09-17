import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Project Re-entry — Discord Conversation Intelligence",
  description: "You don't need another summary. You need to know what happened while you were gone.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased font-sans bg-zinc-950 text-zinc-100`}>
        {children}
      </body>
    </html>
  );
}
