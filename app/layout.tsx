import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Infall — Kerr Black Hole Simulator',
  description: 'First-person geodesic infall into a rotating black hole.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
