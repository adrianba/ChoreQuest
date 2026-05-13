import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Full-screen Windows-Update-style overlay shown when an in-app update is triggered.
 *
 * Flow:
 *  1. Listen for the custom 'app:update-triggered' event dispatched by Settings.jsx.
 *  2. Rendered via React Portal directly into document.body so it is never trapped
 *     inside Layout's overflow / stacking context (fixes iOS Safari fixed-position bug).
 *  3. While visible: body scroll + touch-action are locked so nothing behind the
 *     overlay is tappable or navigable on mobile.
 *  4. Fake-count from 0 → ~80 % over ~90 seconds (covers the container restart time).
 *  5. Poll /api/health every 4 s.  Once the returned `version` differs from the one
 *     that was running when the update started, snap to 100 % and reload.
 *  6. Hard-safety: if the app hasn't come back after 5 minutes, show a manual-reload
 *     button so the user is never stuck.
 */

const POLL_INTERVAL_MS  = 4_000;
const SAFETY_TIMEOUT_MS = 4 * 60_000 + 30_000; // 4 min 30 sec — covers slow container rebuilds

// Eased fake-progress: rises steadily then slows near the end.
// Tied to SAFETY_TIMEOUT_MS so the bar keeps moving the whole time
// and never appears "stuck" waiting for the restart.
function fakePercent(elapsedMs) {
  const t = Math.min(elapsedMs / SAFETY_TIMEOUT_MS, 1);
  return Math.round(80 * (1 - Math.pow(1 - t, 1.8)));
}

// Spinning-dots row — three dots that pulse in sequence (Windows 11 style).
function SpinDots() {
  return (
    <div className="flex items-center justify-center gap-3 my-6">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-3 h-3 rounded-full bg-white/80"
          style={{ animation: `win-dot 1.4s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  );
}

// Large ring spinner (mimics the Windows Update circular progress).
function RingSpinner({ percent }) {
  const r            = 54;
  const cx           = 64;
  const circumference = 2 * Math.PI * r;
  const offset       = circumference * (1 - percent / 100);

  return (
    <div className="relative flex items-center justify-center w-32 h-32 mx-auto">
      <svg className="absolute inset-0 -rotate-90" width="128" height="128" viewBox="0 0 128 128">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle
          cx={cx} cy={cx} r={r}
          fill="none"
          stroke="white"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <span className="text-2xl font-light text-white tabular-nums select-none">
        {percent}%
      </span>
    </div>
  );
}

export default function UpdateOverlay() {
  const [visible, setVisible]   = useState(false);
  const [percent, setPercent]   = useState(0);
  const [done, setDone]         = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const startVersionRef         = useRef(null);
  const startTimeRef            = useRef(null);
  const pollTimerRef            = useRef(null);
  const safetyTimerRef          = useRef(null);
  const progressTimerRef        = useRef(null);
  // Two-phase restart detection: if the server goes offline then comes back,
  // that is the definitive "container restarted" signal even when GIT_COMMIT
  // is "unknown" on both old and new builds.
  const serverWentDownRef       = useRef(false);
  // Set when the overlay is triggered by the lock-file flag (updating:true on
  // fresh load).  In this case the container may already be the new one, so we
  // dismiss once the lock file is gone (updating:false) rather than waiting for
  // a version change or a server-down event that will never happen.
  const triggeredByLockFileRef  = useRef(false);
  // Passive background monitor — tracks baseline version so we can detect
  // a restart even when the WS broadcast was missed (mobile sleeping tab).
  const bgVersionRef            = useRef(null);
  const bgWasDownRef            = useRef(false);
  const visibleRef              = useRef(false);

  // ------------------------------------------------------------------
  // Show overlay — shared handler used by both trigger sources below.
  // ------------------------------------------------------------------
  const showOverlay = (currentVersion, { fromLockFile = false } = {}) => {
    startVersionRef.current        = currentVersion ?? null;
    startTimeRef.current           = Date.now();
    serverWentDownRef.current      = false;
    triggeredByLockFileRef.current = fromLockFile;
    setPercent(0);
    setDone(false);
    setTimedOut(false);
    setVisible(true);
  };

  // ------------------------------------------------------------------
  // Source 1: local event from Settings.jsx (the admin's own device).
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = (e) => showOverlay(e.detail?.currentVersion);
    window.addEventListener('app:update-triggered', handler);
    return () => window.removeEventListener('app:update-triggered', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep visibleRef in sync so the background monitor can read it without
  // being a dependency of that effect.
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  // ------------------------------------------------------------------
  // Passive background health monitor — runs every 15 s regardless of
  // whether the overlay is visible.  Catches devices whose WebSocket was
  // asleep / disconnected when the broadcast fired (e.g. Android with a
  // backgrounded tab).  When the server goes down then comes back, we
  // show the overlay so the user isn't left on a broken/stale page.
  // ------------------------------------------------------------------
  useEffect(() => {
    const check = async () => {
      if (visibleRef.current) return; // overlay already up, don't interfere
      try {
        const res  = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        const v    = data?.version;

        if (bgVersionRef.current === null) {
          bgVersionRef.current = v; // baseline on first check
          // Fresh page load during an in-progress update: the lock file exists
          // on disk so the health endpoint returns updating:true.  Show the
          // overlay immediately — the WS broadcast already happened before this
          // device connected so it was never received.
          if (data?.updating) showOverlay(v, { fromLockFile: true });
          return;
        }

        if (bgWasDownRef.current) {
          // Server was unreachable and just came back — we may have missed the
          // broadcast.  Only show the overlay when the version actually changed;
          // skip it for transient network errors (WiFi blip, brief server hiccup)
          // where the version is unchanged, avoiding the spurious update-screen
          // described in the bug report.
          bgWasDownRef.current = false;
          const prevVersion = bgVersionRef.current;

          if (
            v &&
            prevVersion &&
            prevVersion !== 'unknown' &&
            v !== 'unknown' &&
            v !== prevVersion
          ) {
            bgVersionRef.current = v; // update baseline only when a real change is detected
            showOverlay(prevVersion);
          }
          // If no version change (transient error), keep bgVersionRef as-is so the
          // baseline remains accurate for any subsequent recovery detection.
          return;
        }

        bgVersionRef.current = v;
      } catch {
        // Server is unreachable — flag it so we show the overlay when it returns
        bgWasDownRef.current = true;
      }
    };

    check(); // baseline immediately on mount
    const interval = setInterval(check, 15_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Source 2: WebSocket broadcast from the server — triggers the overlay
  // on every other connected device (kids' phones, tablets, PCs) so they
  // all see the update screen instead of a broken mid-session experience.
  // ------------------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg?.type === 'update_triggered') {
        showOverlay(msg.version ?? null);
      }
    };
    window.addEventListener('ws:message', handler);
    return () => window.removeEventListener('ws:message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Lock body scroll + touch while the overlay is up.
  // This stops iOS Safari from letting kids tap the nav or swipe away.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;

    const prevOverflow    = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    const prevPosition    = document.body.style.position;

    document.body.style.overflow    = 'hidden';
    document.body.style.touchAction = 'none';
    // iOS Safari needs position:fixed to truly lock scrolling
    document.body.style.position    = 'fixed';
    document.body.style.width       = '100%';

    return () => {
      document.body.style.overflow    = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
      document.body.style.position    = prevPosition;
      document.body.style.width       = '';
    };
  }, [visible]);

  // ------------------------------------------------------------------
  // While visible: fake progress + poll health
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!visible || done) return;

    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setPercent(fakePercent(elapsed));
    }, 800);

    const completeUpdate = () => {
      clearInterval(progressTimerRef.current);
      clearInterval(pollTimerRef.current);
      clearTimeout(safetyTimerRef.current);
      setPercent(100);
      setDone(true);
      setTimeout(() => window.location.reload(), 1800);
    };

    const poll = async () => {
      try {
        const res  = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        const newVersion = data?.version;

        // Phase 1: version string changed (GIT_COMMIT is set on the server)
        if (
          newVersion &&
          startVersionRef.current &&
          startVersionRef.current !== 'unknown' &&
          newVersion !== startVersionRef.current
        ) {
          completeUpdate();
          return;
        }

        // Phase 2: server went offline then came back — container restarted.
        // Reliable even when GIT_COMMIT is "unknown" on both old and new builds.
        if (serverWentDownRef.current) {
          completeUpdate();
          return;
        }

        // Phase 3: overlay was triggered by the lock file on fresh load.
        // The container may have already restarted before we connected, so
        // version won't change and the server may never go down.  Dismiss
        // as soon as the watchdog removes the lock file (updating:false).
        if (triggeredByLockFileRef.current && !data?.updating) {
          completeUpdate();
          return;
        }
      } catch {
        // Server is offline / restarting — flag it so phase 2 can fire
        serverWentDownRef.current = true;
      }
    };
    poll();
    pollTimerRef.current  = setInterval(poll, POLL_INTERVAL_MS);

    safetyTimerRef.current = setTimeout(() => {
      clearInterval(progressTimerRef.current);
      clearInterval(pollTimerRef.current);
      setTimedOut(true);
    }, SAFETY_TIMEOUT_MS);

    return () => {
      clearInterval(progressTimerRef.current);
      clearInterval(pollTimerRef.current);
      clearTimeout(safetyTimerRef.current);
    };
  }, [visible, done]);

  if (!visible) return null;

  const overlay = (
    <>
      {/* Keyframes injected once into the document head via a portal sibling */}
      <style>{`
        @keyframes win-dot {
          0%, 60%, 100% { opacity: 0.15; transform: scale(0.8); }
          30%            { opacity: 1;    transform: scale(1.2); }
        }
        @keyframes win-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/*
        Rendered via portal so it sits directly on document.body, completely
        outside Layout's overflow / stacking context.  This is what makes
        position:fixed cover the whole viewport on iOS Safari.
        touch-action:none + pointer-events:all ensure no tap leaks through.
      */}
      <div
        data-testid="update-overlay"
        className="fixed inset-0 flex flex-col items-center justify-between py-16 px-8 text-white select-none"
        style={{
          zIndex: 2147483647,           // max possible z-index
          background: 'linear-gradient(160deg, #0f1729 0%, #0a0e1a 100%)',
          animation: 'win-fade-in 0.6s ease forwards',
          touchAction: 'none',          // block iOS scroll-through
          pointerEvents: 'all',         // absorb every tap
          // Use dvh (dynamic viewport height) so iOS address-bar chrome is handled
          height: '100dvh',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
        // Belt-and-suspenders: swallow touch/pointer events explicitly
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
      >
        {/* Top: branding */}
        <div className="flex flex-col items-center gap-2 mt-8">
          <span className="text-4xl">⚔️</span>
          <p className="text-white/50 text-sm tracking-widest uppercase">
            ChoreQuest
          </p>
        </div>

        {/* Middle: ring + status */}
        <div className="flex flex-col items-center gap-4">
          {done ? (
            <div className="flex flex-col items-center gap-4">
              <span className="text-6xl animate-bounce">✅</span>
              <p className="text-white text-xl font-light">Update complete!</p>
              <p className="text-white/50 text-sm">Reloading the realm…</p>
            </div>
          ) : timedOut ? (
            <div className="flex flex-col items-center gap-5 text-center">
              <p className="text-white text-lg font-light">Taking longer than expected…</p>
              <p className="text-white/50 text-sm max-w-xs">
                The container may still be restarting. Try reloading manually.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-6 py-2.5 rounded-md bg-white/10 hover:bg-white/20
                           text-white text-sm font-medium transition-colors border border-white/20"
              >
                Reload now
              </button>
            </div>
          ) : (
            <>
              <RingSpinner percent={percent} />
              <SpinDots />
              <p className="text-white text-xl font-light tracking-wide">
                Working on updates
              </p>
              <p className="text-white/40 text-sm">
                {percent < 20
                  ? 'Pulling latest build…'
                  : percent < 45
                  ? 'Rebuilding container…'
                  : percent < 68
                  ? 'Restarting services…'
                  : 'Almost there…'}
              </p>
            </>
          )}
        </div>

        {/* Bottom: disclaimer */}
        <p className="text-white/25 text-xs text-center">
          {done || timedOut
            ? ''
            : "Don't close this window. Your quests will be back shortly."}
        </p>
      </div>
    </>
  );

  // Portal to document.body bypasses Layout's overflow/stacking context entirely
  return createPortal(overlay, document.body);
}
