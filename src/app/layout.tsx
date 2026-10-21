import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import AccessibilityWidget from "@/features/accessibility/AccessibilityWidget";

export const metadata: Metadata = {
  title: "יועץ הרכב של שטראוס",
  description: "סימולטור נטו לבחירת רכב - סביבת הדגמה",
  icons: {
    icon: "/brand/logo.png",
    shortcut: "/brand/logo.png",
    apple: "/brand/logo.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* טיפוגרפיה עברית איכותית: Assistant (fallback למערכת אם לא נטען). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <AccessibilityWidget />
      </body>
    </html>
  );
}