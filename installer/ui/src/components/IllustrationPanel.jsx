// Left-side panel for welcome / finish screens. A stylised "carnet" open
// on a starry night-blue spread. No hand-drawn character — uses the
// geometric approach the design system calls for.

import React, { useMemo } from 'react';

export function IllustrationPanel({ variant = 'welcome' }) {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 14 }).map(() => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        s: 1 + Math.random() * 2,
        o: 0.4 + Math.random() * 0.6,
      })),
    []
  );
  return (
    <div className="nsis-illus">
      {sparkles.map((s, i) => (
        <span
          key={i}
          className="sparkle"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.s,
            height: s.s,
            opacity: s.o,
          }}
        />
      ))}
      {/* moon */}
      <div
        style={{
          position: 'absolute',
          top: 36,
          left: 32,
          width: 70,
          height: 70,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 35% 35%, #F2F5FA 0%, #DCC4A3 45%, #8C9AAF 80%)',
          boxShadow: '0 0 42px rgba(220,196,163,.4)',
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 40,
          left: 36,
          width: 58,
          height: 58,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 65% 55%, transparent 35%, rgba(14,20,36,.92) 36%)',
        }}
      />

      {/* notebook */}
      <div
        style={{
          position: 'absolute',
          bottom: 36,
          left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 148,
          height: 110,
          background: 'linear-gradient(145deg, #1a2340, #0E1424)',
          border: '1px solid rgba(210,166,101,.25)',
          borderRadius: '3px 6px 6px 3px',
          boxShadow:
            '0 12px 30px rgba(0,0,0,.5), inset 2px 0 0 rgba(210,166,101,.4)',
        }}
      >
        {/* spine stitches */}
        {[0.15, 0.35, 0.55, 0.75, 0.95].map((t, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: -1,
              top: `${t * 100}%`,
              width: 3,
              height: 2,
              background: 'var(--gold-soft)',
              borderRadius: 1,
            }}
          />
        ))}
        {/* pages — ruled */}
        {[18, 30, 42, 54, 66, 78].map((y, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: 14,
              right: 14,
              top: y,
              height: 1,
              background: 'rgba(140,154,175,.18)',
            }}
          />
        ))}
        {/* ember seal */}
        <span
          style={{
            position: 'absolute',
            right: 10,
            top: 8,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, var(--ember-orange), #7a3a1c)',
            boxShadow: '0 0 14px rgba(200,100,48,.7)',
          }}
        />
        {/* little starlight rune — just typographic */}
        <span
          style={{
            position: 'absolute',
            left: 14,
            top: 8,
            fontFamily: 'var(--ff-title)',
            fontSize: 11,
            fontStyle: 'italic',
            color: 'var(--gold-soft)',
            letterSpacing: '.08em',
          }}
        >
          {variant === 'finish' ? '✧ fin ✧' : '✧ carnet ✧'}
        </span>
      </div>

      {/* vertical brand ribbon */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 22,
          background:
            'linear-gradient(180deg, rgba(200,100,48,.5), rgba(64,68,155,.4))',
          borderRight: '1px solid rgba(210,166,101,.3)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 4,
          top: 14,
          bottom: 14,
          width: 14,
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: 'var(--silver-cool)',
          fontFamily: 'var(--ff-title)',
          fontSize: 10,
          letterSpacing: '.4em',
          textTransform: 'uppercase',
          opacity: 0.85,
        }}
      >
        Sawa Horizon · v5.0.1
      </div>
    </div>
  );
}

export default IllustrationPanel;
