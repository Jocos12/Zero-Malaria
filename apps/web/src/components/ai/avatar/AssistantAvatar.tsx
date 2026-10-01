import { cn } from '../../../lib/cn';

export type AvatarMood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'greeting';

type Props = {
  mood: AvatarMood;
  /** 0..1 mouth opening from lip sync */
  mouthLevel?: number;
  size?: 'lg' | 'sm';
  className?: string;
  label?: string;
  reduceMotion?: boolean;
  /** Shown under avatar when reduced motion */
  stateLabel?: string;
};

/**
 * Lightweight SVG health-worker avatar (stethoscope). CSS motion only.
 * Moods: idle, listening, thinking, speaking, greeting.
 */
export function AssistantAvatar({
  mood,
  mouthLevel = 0,
  size = 'lg',
  className,
  label = 'AI assistant avatar',
  reduceMotion = false,
  stateLabel,
}: Props) {
  const dim = size === 'lg' ? 148 : 52;
  const open =
    mood === 'speaking'
      ? Math.max(0.1, Math.min(1, mouthLevel))
      : mood === 'listening'
        ? 0.1
        : mood === 'greeting'
          ? 0.35
          : 0.05;
  const mouthH = 2 + open * (size === 'lg' ? 14 : 6);
  const smile = mood === 'greeting' || mood === 'idle';

  if (reduceMotion) {
    return (
      <div
        className={cn('inline-flex flex-col items-center gap-1', className)}
        data-testid="assistant-avatar"
        data-mood={mood}
        data-size={size}
        role="img"
        aria-label={`${label}. ${mood}`}
      >
        <svg width={dim} height={dim} viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="56" fill="#E8F4FC" />
          <ellipse cx="60" cy="108" rx="38" ry="18" fill="#1B6B93" />
          <circle cx="60" cy="52" r="32" fill="#F0C9A0" />
          <path
            d="M32 48c2-18 18-28 28-28s26 10 28 28c-6-8-16-12-28-12s-22 4-28 12z"
            fill="#3D2B1F"
          />
          <circle cx="48" cy="52" r="3.5" fill="#1A1A1A" />
          <circle cx="72" cy="52" r="3.5" fill="#1A1A1A" />
          <ellipse cx="60" cy="72" rx="7" ry="3" fill="#8B3A3A" />
          <circle cx="78" cy="100" r="5" fill="none" stroke="#7DD3C0" strokeWidth="2" />
        </svg>
        {stateLabel ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {stateLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'avatar-root relative inline-flex flex-col items-center transition-transform duration-250',
        mood === 'listening' && 'avatar-lean',
        mood === 'speaking' && 'avatar-bob',
        mood === 'idle' && 'avatar-breathe',
        mood === 'greeting' && 'avatar-greet-tilt',
        className,
      )}
      data-testid="assistant-avatar"
      data-mood={mood}
      data-size={size}
      role="img"
      aria-label={`${label}. ${mood}`}
    >
      {mood === 'listening' ? (
        <span className="avatar-pulse-ring" aria-hidden />
      ) : null}
      <svg width={dim} height={dim} viewBox="0 0 120 120" aria-hidden className="relative z-[1]">
        <circle cx="60" cy="60" r="56" fill="#E8F4FC" />
        <ellipse cx="60" cy="108" rx="38" ry="18" fill="#1B6B93" />
        {/* waving hand (greeting) */}
        {mood === 'greeting' ? (
          <g className="avatar-wave" style={{ transformOrigin: '22px 88px' }}>
            <ellipse cx="22" cy="88" rx="7" ry="10" fill="#F0C9A0" />
          </g>
        ) : null}
        {/* speaking hand gesture */}
        {mood === 'speaking' ? (
          <g className="avatar-hand" style={{ transformOrigin: '96px 92px' }}>
            <ellipse cx="96" cy="92" rx="6" ry="9" fill="#F0C9A0" />
          </g>
        ) : null}
        <g className={mood === 'idle' ? 'avatar-head-tilt' : undefined}>
          <circle cx="60" cy="52" r="32" fill="#F0C9A0" />
          <path
            d="M32 48c2-18 18-28 28-28s26 10 28 28c-6-8-16-12-28-12s-22 4-28 12z"
            fill="#3D2B1F"
          />
          <circle cx="28" cy="54" r="5" fill="#E8B890" />
          <circle cx="92" cy="54" r="5" fill="#E8B890" />
          {/* eyes */}
          <g className={mood === 'idle' ? 'avatar-blink' : undefined}>
            <ellipse
              cx="48"
              cy={mood === 'thinking' ? 48 : 52}
              rx="3.5"
              ry={mood === 'thinking' ? 1.5 : 4}
              fill="#1A1A1A"
            />
            <ellipse
              cx="72"
              cy={mood === 'thinking' ? 48 : 52}
              rx="3.5"
              ry={mood === 'thinking' ? 1.5 : 4}
              fill="#1A1A1A"
            />
          </g>
          {/* brows */}
          <path
            d={
              mood === 'listening' || mood === 'greeting'
                ? 'M40 43h14M66 41h14'
                : mood === 'thinking'
                  ? 'M40 46h14M68 40h12'
                  : mood === 'speaking'
                    ? 'M40 44h14M66 44h14'
                    : 'M40 45h14M66 45h14'
            }
            stroke="#3D2B1F"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <path d="M60 54v8" stroke="#C9956C" strokeWidth="2" strokeLinecap="round" />
          {/* mouth */}
          {smile && mood !== 'speaking' ? (
            <path
              d="M52 70c4 6 12 6 16 0"
              stroke="#8B3A3A"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
          ) : (
            <ellipse cx="60" cy="72" rx={6 + open * 4} ry={mouthH / 2} fill="#8B3A3A" />
          )}
        </g>
        <circle cx="78" cy="100" r="5" fill="none" stroke="#7DD3C0" strokeWidth="2" />
        <path d="M78 95v-8c0-6-8-8-14-6" stroke="#7DD3C0" strokeWidth="2" fill="none" />
        {mood === 'thinking' ? (
          <g className="avatar-think">
            <circle cx="92" cy="28" r="3" fill="#1B6B93" />
            <circle cx="100" cy="22" r="2.2" fill="#1B6B93" opacity="0.75" />
            <circle cx="106" cy="16" r="1.6" fill="#1B6B93" opacity="0.5" />
          </g>
        ) : null}
        {mood === 'listening' ? (
          <g opacity="0.75">
            <path d="M96 48c4 4 4 12 0 16" stroke="#1B6B93" strokeWidth="2" fill="none" />
            <path d="M102 44c7 6 7 20 0 26" stroke="#1B6B93" strokeWidth="2" fill="none" />
          </g>
        ) : null}
      </svg>
      <style>{`
        .avatar-root { --avatar-ease: cubic-bezier(0.22, 1, 0.36, 1); }
        .avatar-breathe { animation: avatar-breathe-kf 3.8s var(--avatar-ease) infinite; }
        .avatar-lean { transform: translateY(2px) scale(1.03); transition: transform 260ms var(--avatar-ease); }
        .avatar-bob { animation: avatar-bob-kf 0.55s var(--avatar-ease) infinite; }
        .avatar-greet-tilt { animation: avatar-greet-kf 0.9s var(--avatar-ease) 1; }
        .avatar-pulse-ring {
          position: absolute; inset: -6px; border-radius: 9999px;
          border: 2px solid rgba(27, 107, 147, 0.45);
          animation: avatar-ring-kf 1.4s ease-out infinite;
        }
        @keyframes avatar-breathe-kf {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        @keyframes avatar-bob-kf {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(2px); }
        }
        @keyframes avatar-greet-kf {
          0% { transform: rotate(0deg); }
          30% { transform: rotate(-3deg); }
          60% { transform: rotate(3deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes avatar-ring-kf {
          0% { transform: scale(0.92); opacity: 0.7; }
          100% { transform: scale(1.12); opacity: 0; }
        }
        @keyframes avatar-blink-kf {
          0%, 90%, 100% { transform: scaleY(1); }
          94% { transform: scaleY(0.08); }
        }
        .avatar-blink { transform-origin: 60px 52px; animation: avatar-blink-kf 4.2s ease-in-out infinite; }
        @keyframes avatar-tilt-kf {
          0%, 100% { transform: rotate(-1.2deg); }
          50% { transform: rotate(1.5deg); }
        }
        .avatar-head-tilt { transform-origin: 60px 70px; animation: avatar-tilt-kf 5.5s ease-in-out infinite; }
        @keyframes avatar-wave-kf {
          0%, 100% { transform: rotate(0deg); }
          40% { transform: rotate(28deg); }
          70% { transform: rotate(-8deg); }
        }
        .avatar-wave { animation: avatar-wave-kf 0.7s ease-in-out 2; }
        @keyframes avatar-hand-kf {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .avatar-hand { animation: avatar-hand-kf 0.7s ease-in-out infinite; }
        @keyframes avatar-think-kf {
          0%, 100% { transform: translateY(0); opacity: 0.45; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
        .avatar-think { animation: avatar-think-kf 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .avatar-breathe, .avatar-bob, .avatar-greet-tilt, .avatar-pulse-ring,
          .avatar-blink, .avatar-head-tilt, .avatar-wave, .avatar-hand, .avatar-think {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
