"use client";

import { useState } from "react";
import Link from "next/link";

export default function HardwarePage() {
  const [connected, setConnected] = useState(false);

  return (
    <main className="h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-4">Hardware Mode</h1>
        <p className="text-xl text-slate-300 mb-8">
          Connect and interact with real ESP32 mesh nodes
        </p>
      </div>

      <div className="bg-slate-800/50 border-2 border-slate-700 rounded-2xl p-8 max-w-2xl w-full backdrop-blur">
        <h2 className="text-xl font-semibold text-white mb-4">Device Connection</h2>
        <p className="text-slate-300 mb-6">
          Hardware mode is under development. This will support:
        </p>
        <ul className="list-disc list-inside space-y-2 text-slate-300 mb-8">
          <li>Real-time ESP32 node discovery and connectivity</li>
          <li>Live sensor data integration</li>
          <li>Direct mesh network interaction</li>
          <li>Message delivery and latency tracking</li>
        </ul>

        <div className="flex gap-4">
          <Link
            href="/"
            className="flex-1 rounded-lg bg-slate-600 hover:bg-slate-500 text-white px-6 py-3 font-medium transition-colors text-center"
          >
            ← Back to Home
          </Link>
        </div>
      </div>

      <footer className="absolute bottom-8 text-center text-sm text-slate-400">
        <p>Check back soon for hardware node connectivity features</p>
      </footer>
    </main>
  );
}
