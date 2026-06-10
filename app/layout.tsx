import type { Metadata } from 'next';
import { EB_Garamond } from 'next/font/google';
import './globals.css';

const garamond = EB_Garamond({ subsets: ['latin'], weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'infall',
  description: 'Kerr black hole simulation.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={garamond.className}>{children}</body>
    </html>
  );
}
