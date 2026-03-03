import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import QueryProvider from "@/components/QueryProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://quick-scoreboard.vercel.app'),
  title: {
    default: 'quick-scoreboard',
    template: '%s | quick-scoreboard',
  },
  description: '회원가입 없이 빠르게 기록하는 풋살 경기 스코어보드',
  applicationName: 'quick-scoreboard',
  icons: {
    icon: [{ url: '/favicon.ico' }, { url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut: ['/favicon.ico'],
  },
  openGraph: {
    title: 'quick-scoreboard',
    description: '회원가입 없이 빠르게 기록하는 풋살 경기 스코어보드',
    siteName: 'quick-scoreboard',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
