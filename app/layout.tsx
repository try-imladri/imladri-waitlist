import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://imladri.com"),
  title: { default: "Imladri — Dating without the swiping", template: "%s · Imladri" },
  description: "A few compatible matches a week, picked from your answers. Join the Imladri waitlist.",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Imladri",
    url: "https://imladri.com/",
    title: "Imladri — Dating without the swiping",
    description: "A few compatible matches a week, picked from your answers. Join the Imladri waitlist.",
    images: [{ url: "/assets/brand/imladri-social-dating-v3.png", width: 1200, height: 630, type: "image/png", alt: "Imladri. Dating without the swiping. Join the waitlist." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Imladri — Dating without the swiping",
    description: "A few compatible matches a week, picked from your answers. Join the Imladri waitlist.",
    images: [{ url: "/assets/brand/imladri-social-dating-v3.png", alt: "Imladri. Dating without the swiping. Join the waitlist." }],
  },
  referrer: "no-referrer",
  icons: {
    icon: [
      { url: "/assets/brand/two-faces-v3/icon-96.png", type: "image/png", sizes: "96x96" },
      { url: "/assets/brand/two-faces-v3/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/assets/brand/two-faces-v3/icon-96-white.png", type: "image/png", sizes: "96x96", media: "(prefers-color-scheme: dark)" },
      { url: "/assets/brand/two-faces-v3/icon-192-white.png", type: "image/png", sizes: "192x192", media: "(prefers-color-scheme: dark)" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/assets/brand/two-faces-v3/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('imladri-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}" }} /></head>
      <body>{children}</body>
    </html>
  );
}
