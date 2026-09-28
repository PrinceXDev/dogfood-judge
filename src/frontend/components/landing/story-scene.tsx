"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useMemo, useRef, useState } from "react";
import { prefersReduced } from "@/components/motion";
import { type DemoResult, jLabel } from "@/lib/demo";

// The scroll story. One pinned SVG scene, scrubbed by scroll, built entirely
// from the story world's engine output: the same 24 projects, 8 judges and 72
// reviews move from a grid, to raw scores, to normalized scores; the judge
// whose removal flips the winner disappears; then the inputs collapse into a
// fingerprint computed in the browser. Under reduced motion the steps render
// as a static list.

const W = 640;
const H = 440;
const JY = 64;

export function StoryScene({ data }: { data: DemoResult }) {
  const root = useRef<HTMLDivElement>(null);
  const [digest, setDigest] = useState("");
  const [staticMode, setStatic] = useState(false);
  const rep = data.report;
  const rb = rep.robustness;
  const flipper = rb?.winner_flips?.[0] ?? "";
  const winner = rb?.winner ?? rep.projects[0].project;
  const moved = rep.projects.filter((p) => p.rank_change !== 0).length;

  const layout = useMemo(() => {
    const ps = rep.projects;
    const all = ps.flatMap((p) => [p.scores.raw, p.scores.biasscale]);
    const lo = Math.min(...all) - 0.05;
    const hi = Math.max(...all) + 0.05;
    const ax = (v: number) => 70 + ((v - lo) / (hi - lo)) * (W - 140);
    const lanes = (key: "raw" | "biasscale") => {
      const out = new Map<string, number>();
      const rows: number[][] = [];
      for (const p of [...ps].sort((a, b) => a.scores[key] - b.scores[key])) {
        const x = ax(p.scores[key]);
        let lane = rows.findIndex((r) => r.every((v) => Math.abs(v - x) > 16));
        if (lane < 0) {
          lane = rows.length;
          rows.push([]);
        }
        rows[lane].push(x);
        out.set(p.project, 360 - lane * 30);
      }
      return out;
    };
    const rawY = lanes("raw");
    const adjY = lanes("biasscale");
    const judges = rep.judges.map((j, i) => ({
      ...j,
      x: 90 + (i * (W - 180)) / Math.max(1, rep.judges.length - 1),
    }));
    const maxBias = Math.max(0.01, ...judges.map((j) => Math.abs(j.bias)));
    return {
      projects: ps.map((p, i) => ({
        id: p.project,
        top: p.ranks.biasscale <= rep.top_k,
        grid: { x: 145 + (i % 8) * 50, y: 200 + Math.floor(i / 8) * 56 },
        raw: { x: ax(p.scores.raw), y: rawY.get(p.project) ?? 300 },
        adj: { x: ax(p.scores.biasscale), y: adjY.get(p.project) ?? 300 },
      })),
      judges,
      maxBias,
    };
  }, [rep]);

  useEffect(() => {
    const bytes = new TextEncoder().encode(JSON.stringify(data.reviews));
    crypto.subtle
      ?.digest("SHA-256", bytes)
      .then((b) =>
        setDigest(
          [...new Uint8Array(b)]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
        ),
      )
      .catch(() => {});
  }, [data.reviews]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (prefersReduced()) {
      setStatic(true);
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(el);
      const edges = q<SVGLineElement>("[data-edge]");
      const pEls = new Map(
        q<SVGCircleElement>("[data-p]").map((c) => [c.dataset.p ?? "", c]),
      );
      const sync = () => {
        for (const e of edges) {
          const c = pEls.get(e.dataset.to ?? "");
          if (!c) continue;
          e.setAttribute("x2", String(c.cx.baseVal.value));
          e.setAttribute("y2", String(c.cy.baseVal.value));
        }
      };
      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut", duration: 1 },
        onUpdate: sync,
        scrollTrigger: {
          trigger: el,
          start: "top top",
          end: () => `+=${window.innerHeight * 7}`,
          scrub: 0.6,
          pin: true,
          anticipatePin: 1,
        },
      });
      const caption = (i: number) => {
        tl.to(q(`[data-cap]`), { opacity: 0, y: -8, duration: 0.3 }, `s${i}`);
        tl.fromTo(
          q(`[data-cap="${i}"]`),
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.4 },
          `s${i}+=0.2`,
        );
      };
      tl.addLabel("s0");
      caption(0);
      tl.fromTo(
        q("[data-p]"),
        { attr: { r: 0 } },
        { attr: { r: 5 }, stagger: 0.02, duration: 0.6 },
        "s0",
      );
      tl.addLabel("s1", "+=0.4");
      caption(1);
      tl.fromTo(
        q("[data-j]"),
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, stagger: 0.05, duration: 0.5 },
        "s1",
      );
      tl.addLabel("s2", "+=0.4");
      caption(2);
      tl.fromTo(
        edges,
        { opacity: 0 },
        { opacity: 0.4, stagger: 0.006, duration: 0.5 },
        "s2",
      );
      tl.addLabel("s3", "+=0.4");
      caption(3);
      tl.to(q("[data-axis]"), { opacity: 1, duration: 0.4 }, "s3");
      tl.fromTo(
        q("[data-bias]"),
        { attr: { width: 0 } },
        {
          attr: {
            width: (_i: number, t: Element) =>
              Number((t as SVGElement).dataset.w ?? 0),
          },
          duration: 0.6,
        },
        "s3",
      );
      for (const p of layout.projects)
        tl.to(
          pEls.get(p.id) ?? [],
          { attr: { cx: p.raw.x, cy: p.raw.y } },
          "s3",
        );
      tl.addLabel("s4", "+=0.4");
      caption(4);
      for (const p of layout.projects) {
        tl.to(
          pEls.get(p.id) ?? [],
          { attr: { cx: p.adj.x, cy: p.adj.y } },
          "s4",
        );
      }
      tl.to(
        q("[data-top]"),
        { fill: "var(--accent)", attr: { r: 7 }, duration: 0.5 },
        "s4+=0.5",
      );
      tl.addLabel("s5", "+=0.4");
      caption(5);
      if (flipper) {
        tl.to(
          q(`[data-j="${flipper}"]`),
          { opacity: 0.12, duration: 0.5 },
          "s5",
        );
        tl.to(
          q(`[data-edge][data-from="${flipper}"]`),
          { opacity: 0, duration: 0.5 },
          "s5",
        );
        tl.to(
          q(`[data-p="${winner}"]`),
          { fill: "var(--warn)", attr: { r: 9 }, duration: 0.4 },
          "s5+=0.3",
        );
      }
      tl.addLabel("s6", "+=0.4");
      caption(6);
      if (flipper) {
        tl.to(q(`[data-j="${flipper}"]`), { opacity: 1, duration: 0.4 }, "s6");
        tl.to(
          q(`[data-edge][data-from="${flipper}"]`),
          { opacity: 0.4, duration: 0.4 },
          "s6",
        );
        tl.to(
          q(`[data-p="${winner}"]`),
          { fill: "var(--accent)", attr: { r: 7 }, duration: 0.4 },
          "s6",
        );
      }
      tl.fromTo(
        q("[data-ring]"),
        { opacity: 0, attr: { r: 30 } },
        { opacity: 1, attr: { r: 18 }, duration: 0.5 },
        "s6+=0.2",
      );
      tl.addLabel("s7", "+=0.4");
      caption(7);
      tl.to(
        [edges, q("[data-j]"), q("[data-axis]"), q("[data-ring]")],
        { opacity: 0, duration: 0.5 },
        "s7",
      );
      tl.to(
        q("[data-p]"),
        { attr: { cx: W / 2, cy: 250, r: 2 }, stagger: 0.01, duration: 0.7 },
        "s7",
      );
      tl.fromTo(
        q("[data-block]"),
        { opacity: 0, scale: 0.9 },
        { opacity: 1, scale: 1, duration: 0.5, transformOrigin: "50% 50%" },
        "s7+=0.6",
      );
      tl.addLabel("s8", "+=0.4");
      caption(8);
      tl.fromTo(
        q("[data-check]"),
        { opacity: 0, strokeDashoffset: 60 },
        { opacity: 1, strokeDashoffset: 0, duration: 0.6 },
        "s8",
      );
      tl.to({}, { duration: 0.6 });
    }, el);
    return () => ctx.revert();
  }, [layout, flipper, winner]);

  const captions: [string, string][] = [
    [
      "Every hackathon creates hundreds of decisions.",
      `${data.config.projects} projects enter the pack.`,
    ],
    [
      "Those decisions are made by judges.",
      `${data.config.judges} judges, each seeing only a few projects.`,
    ],
    [
      "Every review is a connection.",
      `${data.reviews.length} reviews link judges to projects. No judge sees them all.`,
    ],
    [
      "Judges don't score the same way.",
      "Plotted by raw mean, projects inherit their judges' habits: lenient judges lift, harsh judges sink.",
    ],
    [
      "Normalization helps.",
      `The engine estimates every judge's leniency and scale jointly. ${moved} of ${data.config.projects} projects change rank.`,
    ],
    [
      "But what if one judge changes everything?",
      flipper
        ? `Remove ${jLabel(flipper)} and the model is refitted: first place changes hands.`
        : "Every judge is removed in turn and the model refitted.",
    ],
    [
      "Now you can see it.",
      rb
        ? `The winner holds in ${rb.winner_held} of ${rb.refits} refits. That number is on every results page.`
        : "",
    ],
    [
      "Now prove it.",
      "Every review collapses into one fingerprint, signed with the portal's Ed25519 key.",
    ],
    [
      "Now verify it.",
      "Anyone re-runs the engine offline and gets the same order, or learns exactly what differs.",
    ],
  ];

  if (staticMode) {
    return (
      <ol className="mx-auto grid max-w-3xl gap-6 px-4 py-20">
        {captions.map(([t, s], i) => (
          <li key={t} className="flex gap-4">
            <span className="font-mono text-xs text-accent">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="text-xl font-semibold tracking-tight">{t}</p>
              <p className="mt-1 text-ink-2">{s}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div ref={root} className="relative h-dvh overflow-hidden">
      <div className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="relative mx-auto grid h-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="relative h-40 lg:h-64">
          {captions.map(([t, s], i) => (
            <div key={t} data-cap={i} className="absolute inset-0 opacity-0">
              <p className="font-mono text-xs text-accent">
                {String(i + 1).padStart(2, "0")} /{" "}
                {String(captions.length).padStart(2, "0")}
              </p>
              <h3 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl lg:text-5xl">
                {t}
              </h3>
              <p className="mt-4 max-w-md text-pretty text-ink-2">{s}</p>
            </div>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Animated judging graph: projects, judges and reviews moving from raw to normalized scores."
        >
          <g data-axis opacity={0}>
            <line
              x1={60}
              x2={W - 60}
              y1={392}
              y2={392}
              stroke="var(--line-strong)"
            />
            <text
              x={W - 60}
              y={412}
              textAnchor="end"
              className="fill-muted font-mono text-[10px]"
            >
              higher score →
            </text>
          </g>
          {data.reviews.map((r) => {
            const j = layout.judges.find((x) => x.judge === r.judge);
            const p = layout.projects.find((x) => x.id === r.project);
            return (
              <line
                key={`${r.judge}-${r.project}`}
                data-edge
                data-from={r.judge}
                data-to={r.project}
                x1={j?.x}
                y1={JY + 8}
                x2={p?.grid.x}
                y2={p?.grid.y}
                stroke="var(--accent-2)"
                strokeWidth={0.7}
                opacity={0}
              />
            );
          })}
          {layout.judges.map((j) => (
            <g key={j.judge} data-j={j.judge} opacity={0}>
              <rect
                data-bias
                data-w={(Math.abs(j.bias) / layout.maxBias) * 22}
                x={
                  j.bias >= 0
                    ? j.x + 11
                    : j.x - 11 - (Math.abs(j.bias) / layout.maxBias) * 22
                }
                y={JY - 2}
                width={0}
                height={4}
                rx={2}
                fill={j.bias >= 0 ? "var(--warn)" : "var(--info)"}
              />
              <circle
                cx={j.x}
                cy={JY}
                r={8}
                fill="var(--surface)"
                stroke="var(--accent-2)"
                strokeWidth={1.5}
              />
              <text
                x={j.x}
                y={JY - 16}
                textAnchor="middle"
                className="fill-muted font-mono text-[9px]"
              >
                {j.judge}
              </text>
            </g>
          ))}
          {layout.projects.map((p) => (
            <circle
              key={p.id}
              data-p={p.id}
              data-top={p.top ? "" : undefined}
              cx={p.grid.x}
              cy={p.grid.y}
              r={0}
              fill="var(--ink-2)"
            />
          ))}
          <circle
            data-ring
            cx={layout.projects.find((p) => p.id === winner)?.adj.x}
            cy={layout.projects.find((p) => p.id === winner)?.adj.y}
            r={18}
            fill="none"
            stroke="var(--accent)"
            strokeDasharray="3 3"
            opacity={0}
          />
          <g data-block opacity={0}>
            <rect
              x={W / 2 - 150}
              y={210}
              width={300}
              height={80}
              rx={10}
              fill="var(--surface)"
              stroke="var(--line-strong)"
            />
            <text
              x={W / 2}
              y={238}
              textAnchor="middle"
              className="fill-muted font-mono text-[9px] tracking-[0.2em]"
            >
              INPUT FINGERPRINT · SHA-256
            </text>
            <text
              x={W / 2}
              y={262}
              textAnchor="middle"
              className="fill-accent font-mono text-[11px]"
            >
              {digest ? `${digest.slice(0, 32)}` : "computing…"}
            </text>
            <text
              x={W / 2}
              y={278}
              textAnchor="middle"
              className="fill-muted font-mono text-[11px]"
            >
              {digest ? digest.slice(32) : ""}
            </text>
            <path
              data-check
              d={`M ${W / 2 - 14} 330 l 9 9 l 20 -22`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={60}
              opacity={0}
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
