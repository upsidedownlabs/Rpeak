"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, PieChart, BookOpen, Menu, X } from 'lucide-react';

export default function NavBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="fixed top-0 left-0 right-0 bg-black backdrop-blur-md border-b border-white/10 z-70">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-400" />
            <span className="text-white font-bold text-lg">Rpeak</span>
          </Link>

          {/* Hamburger menu for mobile */}
          <button
            className="sm:hidden flex items-center p-2"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            {menuOpen ? <X className="w-6 h-6 text-white" /> : <Menu className="w-6 h-6 text-white" />}
          </button>

          {/* Desktop menu */}
          <div className="hidden sm:flex items-center gap-4">
            <Link
              href="/"
              className={`px-4 py-2 rounded-lg transition-colors ${
                pathname === '/' 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Monitor
            </Link>
            <Link
              href="/train"
              className={`px-4 py-2 rounded-lg transition-colors ${
                pathname === '/train' 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2">
                <PieChart className="w-4 h-4" />
                AI Model
              </span>
            </Link>
            <Link
              href="/docs"
              className={`px-4 py-2 rounded-lg transition-colors ${
                pathname === '/docs' 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Docs
              </span>
            </Link>
          </div>
        </div>
        {/* Mobile menu */}
        {menuOpen && (
          <div className="sm:hidden flex flex-col gap-2 mt-2 pb-4">
            <Link
              href="/"
              className={`px-4 py-2 rounded-lg transition-colors ${
                pathname === '/' 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-gray-400 hover:text-white'
              }`}
              onClick={() => setMenuOpen(false)}
            >
              Monitor
            </Link>
            <Link
              href="/train"
              className={`px-4 py-2 rounded-lg transition-colors ${
                pathname === '/train' 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-gray-400 hover:text-white'
              }`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="flex items-center gap-2">
                <PieChart className="w-4 h-4" />
                AI Model
              </span>
            </Link>
            <Link
              href="/docs"
              className={`px-4 py-2 rounded-lg transition-colors ${
                pathname === '/docs' 
                  ? 'bg-blue-500/20 text-blue-400' 
                  : 'text-gray-400 hover:text-white'
              }`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Docs
              </span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}