// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { ModelProvider } from "@/providers/ModelProvider";
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: "Rpeak",
  description: "ECG monitoring and analysis with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <ModelProvider>
          <NavBar />
          <div className="pt-16 h-[calc(100vh-4rem)]">
            {children}
          </div>
        </ModelProvider>
      </body>
    </html>
  );
}