import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CodeForge - Online Compiler IDE",
  description: "A modern browser-based IDE inspired by VS Code. Write, execute, save, and download code in multiple programming languages with real-time editor intelligence.",
  keywords: ["online compiler", "IDE", "VS Code", "code editor", "Monaco", "Python", "JavaScript", "C++"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ margin: 0, padding: 0, overflow: 'hidden' }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
