"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { VizPace } from "./viz";

// The demo plays like a short product video: a prompt types itself, tools
// run, a live chart animates, two insight cards appear, then a coach summary
// lands. Driven by a single requestAnimationFrame clock; plays once when
// scrolled into view and rests on the final frame.

const SEG = 7200; // ms in the (single) prompt segment
const T = { typeStart: 900, typeEnd: 2050, think: 2300, tools: 3150, chart: 4350, summary: 5750 };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
// eased reveal 0..1 over `dur` starting at `start`, given local elapsed `e`
const rise = (e: number, start: number, dur: number) => {
  const p = clamp01((e - start) / dur);
  return 1 - Math.pow(1 - p, 3); // easeOutCubic
};

type Tool = { src: string; name: string };
type Card = { label: string; body: string };

const SEGMENT = {
  greet: "Afternoon",
  prompt: "Compare my easy pace this year — Jan vs Feb vs March, against easy HR.",
  status: "Comparing monthly easy pace against easy-run HR",
  tools: [
    { src: "STRAVA", name: "get-easy-runs" },
    { src: "STRAVA", name: "compare-periods" },
    { src: "COROS", name: "get-training-zones" },
  ] as Tool[],
  toolText:
    "Filtering easy runs by month, charting pace against easy-run HR, and using your zones to spot whether aerobic efficiency is improving.",
  cards: [
    {
      label: "What changed",
      body: "Pace improved every month while easy-run HR dropped — a clear sign your aerobic engine is getting stronger, not just that you ran harder.",
    },
    {
      label: "How Claude knows",
      body: "Your easy runs were grouped by month using your training zones, then pace and HR were compared across January, February and March.",
    },
  ] as Card[],
  coach:
    "Your easy pace trend is moving in the right way: from roughly 5:23/km in January to 5:08/km in March, while easy HR fell from 149 bpm to 145 bpm, which suggests improving aerobic efficiency.",
};

type Phase = "type" | "think" | "tools" | "chart" | "summary";

export function ChatDemo() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const [gt, setGt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(false);

  const TOTAL = SEG;

  // Appear + auto-start once scrolled into view. Honors reduced-motion by
  // jumping straight to the final frame.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    // Reduced-motion users get the fully-composed final frame, no animation.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      startedRef.current = true;
      elapsedRef.current = TOTAL - 1;
      // Defer out of the synchronous effect body to the next frame.
      const id = requestAnimationFrame(() => {
        setShown(true);
        setGt(TOTAL - 1);
      });
      return () => cancelAnimationFrame(id);
    }

    // Play once when the player is genuinely scrolled into view. The player's
    // top can sit inside the initial viewport just under the hero — on phones,
    // but also on large/tall desktop displays — so a plain threshold fires on
    // load and the demo plays out before the user ever reaches it. The negative
    // bottom rootMargin holds the trigger until the player's top has scrolled
    // up past ~60% of the viewport, which only happens once the user is
    // actually looking at it.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !startedRef.current) {
          startedRef.current = true;
          setShown(true);
          setPlaying(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -40% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [TOTAL]);

  // Master clock — rAF based, plays once, no loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 120);
      last = now;
      const next = elapsedRef.current + dt;
      if (next >= TOTAL) {
        elapsedRef.current = TOTAL - 1;
        setGt(TOTAL - 1);
        setPlaying(false);
        return;
      }
      elapsedRef.current = next;
      setGt(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, TOTAL]);

  const e = gt;

  let phase: Phase = "type";
  if (e >= T.summary) phase = "summary";
  else if (e >= T.chart) phase = "chart";
  else if (e >= T.tools) phase = "tools";
  else if (e >= T.think) phase = "think";

  // typed prompt
  const typeP = clamp01((e - T.typeStart) / (T.typeEnd - T.typeStart));
  const typed = SEGMENT.prompt.slice(0, Math.floor(typeP * SEGMENT.prompt.length));
  const typing = e < T.typeEnd;

  // phase reveal factors
  const oThink = phase === "think";
  const oDone = e >= T.tools;
  const oTools = rise(e, T.tools, 350);
  const oChart = e >= T.chart;
  const oCoach = rise(e, T.summary, 450);

  const fadeStyle = (factor: number, dy = 8) => ({
    opacity: factor,
    transform: `translateY(${(1 - factor) * dy}px)`,
  });

  return (
    <section className="demo-section" id="demo">
      <div ref={wrapRef} className={"player" + (shown ? " in" : "")}>
        <div className="window">
          <div className="win-bar">
            <div className="win-traffic">
              <span />
              <span />
              <span />
            </div>
            <div className="win-url">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="5" width="18" height="14" rx="3" />
              </svg>
              CLAUDE.AI
            </div>
          </div>

          <div className="chat">
            {shown && (
              <>
            <div className="chat-greet">
              <Image src="/claude-star.png" alt="Claude" width={26} height={22} />
              <span className="g">{SEGMENT.greet}</span>
            </div>

            <div className="bubble msg-prompt">
              <div className="txt">
                {typed}
                {typing && <span className="cursor" />}
              </div>
              <div className="foot">
                <span className="model">Sonnet 4.6</span>
                <span className="send">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </span>
              </div>
            </div>

            <div className="stack">
              {oThink && (
                <div className="status">
                  <span>{SEGMENT.status}</span>
                  <span className="tdots">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              )}
              {oDone && (
                <div className="status done">
                  <span className="check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-9" />
                    </svg>
                  </span>
                  <span>{SEGMENT.status}</span>
                </div>
              )}

              {oTools > 0.01 && (
                <div className="bubble tools" style={fadeStyle(oTools)}>
                  <div className="tools-h">
                    <span className="d" />
                    <span className="lbl">USING EVOLVERUN TOOLS</span>
                    <span className="pill">EVOLVERUN</span>
                  </div>
                  <div className="tool-grid">
                    {SEGMENT.tools.map((tl, i) => {
                      const f = rise(e, T.tools + i * 220, 320);
                      return (
                        <span
                          key={tl.name}
                          className="tool-chip"
                          style={{ opacity: f, transform: `translateY(${(1 - f) * 6}px) scale(${0.96 + f * 0.04})` }}
                        >
                          <span className="src">{tl.src}</span>
                          {tl.name}
                        </span>
                      );
                    })}
                  </div>
                  <p className="tool-explain">{SEGMENT.toolText}</p>
                </div>
              )}

              {oChart && <VizPace e={e} />}

              {oCoach > 0.01 &&
                SEGMENT.cards.map((c, i) => {
                  const f = rise(e, T.summary + i * 280, 420);
                  return (
                    <div key={c.label} className="bubble insight" style={fadeStyle(f)}>
                      <div className="insight-label">{c.label}</div>
                      <p className="insight-body">{c.body}</p>
                    </div>
                  );
                })}
            </div>
              </>
            )}
          </div>

          <div className="coach" style={{ opacity: shown ? oCoach : 0 }}>
            {SEGMENT.coach}
          </div>
        </div>
      </div>

      <div className="demo-cta reveal">
        <Link className="btn btn-dark btn-lg" href="/signup">
          Try it on your data <span className="arrow">→</span>
        </Link>
      </div>
    </section>
  );
}
