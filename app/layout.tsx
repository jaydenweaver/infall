import type { Metadata } from 'next';
import { EB_Garamond } from 'next/font/google';
import './globals.css';

const garamond = EB_Garamond({ subsets: ['latin'], weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'Infall — Kerr Black Hole Simulator',
  description: 'First-person geodesic infall into a rotating black hole.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={garamond.className}>{children}</body>
    </html>
  );
}
