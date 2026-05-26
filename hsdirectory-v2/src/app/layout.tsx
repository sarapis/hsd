import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { ServiceChat } from "@/components/chat/ServiceChat";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "HSDirectory - Find Community Resources",
    template: "%s | HSDirectory",
  },
  description: "Search and discover community services and resources in your area. Powered by Open Referral HSDS.",
  keywords: ["community services", "human services", "social services", "resources", "directory"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <a
          href="#main-content" className="absolute left-1 top-0 z-[100] bg-white transform -translate-y-full py-4 px-6 
          font-bold underline focus:translate-y-1 transition"
        >
          Skip to main content
        </a>
        <Header />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
        <ServiceChat />
      </body>
    </html>
  );
}
