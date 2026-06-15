import "./globals.css";

export const metadata = {
  title: "Cart E. Bee — by Jay Nargundkar",
  description: "Convert a recipe photo, screenshot, or link into a shopping list instantly.",
  openGraph: {
    title: "Cart E. Bee — by Jay Nargundkar",
    description: "Convert a recipe photo, screenshot, or link into a shopping list instantly",
    url: "https://cart-e-bee.vercel.app",
    siteName: "Cart E. Bee",
    images: [
      {
        url: "https://cart-e-bee.vercel.app/og-image.png",
        width: 1200,
        height: 630,
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cart E. Bee — by Jay Nargundkar",
    description: "Convert a recipe photo, screenshot, or link into a shopping list instantly.",
    images: ["https://cart-e-bee.vercel.app/og-image.png"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
