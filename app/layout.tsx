import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'CrashLens — Intelligent incident investigation',
  description: 'AI-powered production error clustering, root-cause analysis, and incident timelines.',
  openGraph: {
    title: 'CrashLens — Intelligent incident investigation',
    description: 'See the cause. Fix it faster.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CrashLens — See the cause. Fix it faster.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CrashLens — Intelligent incident investigation',
    description: 'See the cause. Fix it faster.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
