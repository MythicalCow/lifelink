"use client";

import { useState } from "react";
import Link from "next/link";

export default function Home() {
  const [selectedMode, setSelectedMode] = useState<"hardware" | null>(null);

  return (
    <main className="h-screen w-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center gap-12 px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-white mb-4">LifeLink</h1>
        <p className="text-xl text-slate-300">
          Human flourishing tracker — Mesh network for emergency communications
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        {/* Hardware Mode */}
        <Link
          href="/hardware"
          className="group relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-slate-700 bg-slate-800/50 px-8 py-12 backdrop-blur transition-all hover:border-emerald-500/50 hover:bg-emerald-900/20"
        >
          <div className="text-5xl">📡</div>
          <h2 className="text-2xl font-bold text-white">Hardware Mode</h2>
          <p className="text-center text-slate-300">
            Connect to real ESP32 nodes and interact with live mesh networks
          </p>
          <div className="mt-4 flex items-center gap-2 text-emerald-400 opacity-0 transition-opacity group-hover:opacity-100">
            <span>Launch Hardware</span>
            <span>→</span>
          </div>
        </Link>

        {/* Simulation Mode */}
        <Link
          href="/simulation"
          className="group relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-slate-700 bg-slate-800/50 px-8 py-12 backdrop-blur transition-all hover:border-blue-500/50 hover:bg-blue-900/20"
        >
          <div className="text-5xl">🔬</div>
          <h2 className="text-2xl font-bold text-white">Simulation Mode</h2>
          <p className="text-center text-slate-300">
            Test mesh protocols, malicious nodes, and network resilience
          </p>
          <div className="mt-4 flex items-center gap-2 text-blue-400 opacity-0 transition-opacity group-hover:opacity-100">
            <span>Launch Simulator</span>
            <span>→</span>
          </div>
        </Link>
      </div>

      <footer className="absolute bottom-8 text-center text-sm text-slate-400">
        <p>LifeLink v0.2.0 — Multi-hop mesh for decentralized connectivity</p>
      </footer>
    </main>
  );
}
