"use client";
import { useEffect, useState } from "react";

const STAGES = [
  "Reading your profile",
  "Matching keywords to the JD",
  "Drafting tailored bullets",
  "Scoring for ATS",
];

interface MagicRevealProps {
  stage: 1 | 2 | 3 | 4 | "done";
  atsScore: number | null;
}

export default function MagicReveal({ stage, atsScore }: MagicRevealProps) {
  const [shownScore, setShownScore] = useState(0);
  const [confettiFired, setConfettiFired] = useState(false);
  const isDone = stage === "done";
  const stageIndex = isDone ? 4 : (stage as number);

  useEffect(() => {
    if (!isDone || atsScore === null) return;
    const start = Date.now();
    const duration = 1200;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setShownScore(Math.round(atsScore * p));
      if (p < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [isDone, atsScore]);

  useEffect(() => {
    if (!isDone || atsScore === null || atsScore < 80 || confettiFired) return;
    setConfettiFired(true);
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const motes = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * 100,
      r: 4 + Math.random() * 4,
      d: 2 + Math.random() * 3,
      color: Math.random() > 0.5 ? "#1f5c3a" : "#b8912f",
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.2,
    }));
    const endTime = Date.now() + 1000;
    const animate = () => {
      if (Date.now() > endTime) { canvas.remove(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      motes.forEach(m => {
        m.y += m.d;
        m.angle += m.spin;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        ctx.fillStyle = m.color;
        ctx.fillRect(-m.r / 2, -m.r / 2, m.r, m.r);
        ctx.restore();
      });
      requestAnimationFrame(animate);
    };
    animate();
  }, [isDone, atsScore, confettiFired]);

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
        <div
          className="absolute rounded-full"
          style={{
            width: 64, height: 64,
            background: "radial-gradient(circle, #1f5c3a 0%, transparent 70%)",
            filter: "blur(12px)",
            animation: isDone ? "none" : "orbPulse 2s ease-in-out infinite",
            opacity: isDone ? 0.4 : 0.8,
          }}
        />
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle
            cx="32" cy="32" r="24"
            fill={isDone ? "#1f5c3a" : "none"}
            stroke="#1f5c3a"
            strokeWidth="2"
            style={{ transition: "all 0.5s" }}
          />
          {isDone ? (
            <path d="M22 32 L29 39 L42 25" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <circle cx="32" cy="32" r="8" fill="#1f5c3a" style={{ animation: "orbPulse 1.5s ease-in-out infinite" }} />
          )}
        </svg>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-xs">
        {STAGES.map((label, i) => {
          const idx = i + 1;
          const revealed = stageIndex >= idx;
          const done = isDone || stageIndex > idx;
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all duration-500"
              style={{
                background: revealed ? "#1f5c3a10" : "transparent",
                opacity: revealed ? 1 : 0.3,
                color: revealed ? "#1a1a1a" : "#6b6b6b",
                transform: revealed ? "translateX(0)" : "translateX(-8px)",
              }}
            >
              <span style={{ color: done ? "#1f5c3a" : "#b8912f" }}>{done ? "✓" : "✦"}</span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      {isDone && atsScore !== null && (
        <div className="flex flex-col items-center gap-1 mt-2">
          <div className="text-5xl font-bold" style={{ color: atsScore >= 80 ? "#1f5c3a" : "#b8912f" }}>
            {shownScore}
          </div>
          <div className="text-sm" style={{ color: "#6b6b6b" }}>ATS Score</div>
          {atsScore >= 80 && (
            <div className="text-xs mt-1 px-3 py-1 rounded-full" style={{ background: "#1f5c3a15", color: "#1f5c3a" }}>
              Excellent - this resume is well-optimised
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
