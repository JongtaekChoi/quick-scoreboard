import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
    default: '광염 풋살 리그 기록',
    template: '%s | 광염 풋살 리그 기록',
  },
  description: '리그 경기 기록을 빠르게 입력하고 공유하는 풋살 스코어보드',
  applicationName: '광염 풋살 리그 기록',
  keywords: ['풋살', '스코어보드', '리그 기록', '경기 기록', '광염'],
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }],
    shortcut: ['/icon.svg'],
    apple: [{ url: '/icon.svg' }],
  },
  openGraph: {
    title: '광염 풋살 리그 기록',
    description: '리그 경기 기록을 빠르게 입력하고 공유하는 풋살 스코어보드',
    siteName: '광염 풋살 리그 기록',
    type: 'website',
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary',
    title: '광염 풋살 리그 기록',
    description: '리그 경기 기록을 빠르게 입력하고 공유하는 풋살 스코어보드',
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
        {children}
      </body>
    </html>
  );
}
