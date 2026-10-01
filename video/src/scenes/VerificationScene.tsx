import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AuditChain } from "../components/AuditChain";
import { BrowserWindow } from "../components/BrowserWindow";
import { FileIcon } from "../components/Icons";
import { MockScreen } from "../components/MockScreens";
import { SceneShell } from "../components/SceneShell";
import { SectionTitle } from "../components/SectionTitle";
import { Sfx } from "../components/Sfx";
import { type TermLine, TerminalWindow } from "../components/TerminalWindow";
import { VerificationBadge } from "../components/VerificationBadge";
import { ease, pop, progress, rand, rise, windowed } from "../lib/anim";
import { useScene } from "../lib/scene";
import { C, fonts } from "../lib/theme";

const KEY = "7d7a383e43e39e4b";
const CMD = `dogfood verify-results bundle.json --key ${KEY}`;

const PARTS = [
  { label: "Ranking", sub: "adjusted scores, every project" },
  { label: "Inputs", sub: "pseudonymized raw reviews" },
  { label: "Fingerprint", sub: "SHA-256 of canonical inputs" },
  { label: "Audit anchor", sub: "hash of results.publish" },
];

const CHAIN = [
  { action: "event.create", hash: "a41f…09c2" },
  { action: "review.submit", hash: "7be0…d311" },
  { action: "tiebreak.run", hash: "c5d2…8e4a" },
  { action: "voting.close", hash: "19aa…f07b" },
  { action: "results.publish", hash: "e93c…2b16" },
];

/** A tiny RFC 6962 Merkle tree with one review's inclusion path lit. */
const Merkle: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const levels = [8, 4, 2, 1];
  const leaf = 5;
  const W = 620;
  const pathIdx = levels.map((_, l) => Math.floor(leaf / 2 ** l));
  return (
    <div style={{ position: "relative", width: W, height: 360 }}>
      {levels.map((count, l) => {
        const y = 300 - l * 95;
        return Array.from({ length: count }, (_, i) => {
          const x = ((i + 0.5) / count) * W;
          const onPath = pathIdx[l] === i;
          const sibling = l < 3 && Math.floor(i / 2) === Math.floor(pathIdx[l] / 2) && !onPath;
          const lit = progress(frame, at + 12 + l * 10, 10);
          const color = onPath ? C.good : sibling ? C.accent2 : C.lineStrong;
          return (
            <div key={`${l}-${i}`}>
              {l > 0
                ? [0, 1].map((c) => {
                    const cx = ((i * 2 + c + 0.5) / (count * 2)) * W;
                    const childOn = pathIdx[l - 1] === i * 2 + c && onPath;
                    const dx = cx - x;
                    const len = Math.hypot(dx, 95);
                    return (
                      <div
                        key={c}
                        style={{
                          position: "absolute",
                          left: x,
                          top: y + 14,
                          width: len,
                          height: 2,
                          background: childOn ? `rgba(79,227,154,${0.3 + 0.7 * lit})` : C.line,
                          transform: `rotate(${Math.atan2(95, dx)}rad)`,
                          transformOrigin: "0 50%",
                        }}
                      />
                    );
                  })
                : null}
              <div
                style={{
                  position: "absolute",
                  left: x - 30,
                  top: y,
                  width: 60,
                  height: 28,
                  borderRadius: 7,
                  background: C.surface,
                  border: `1.5px solid ${onPath || sibling ? color : C.lineStrong}`,
                  boxShadow: onPath ? `0 0 ${16 * lit}px ${C.good}` : "none",
                  opacity: pop(frame, at + l * 4),
                }}
              />
            </div>
          );
        });
      })}
      <div style={{ position: "absolute", left: W / 2 + 46, top: 18, fontFamily: fonts.mono, fontSize: 16, color: C.good, opacity: progress(frame, at + 42, 10) }}>
        review_root · in the signed manifest
      </div>
      <div style={{ position: "absolute", left: ((leaf + 0.5) / 8) * W - 60, top: 340, fontFamily: fonts.mono, fontSize: 16, color: C.good }}>your review</div>
    </div>
  );
};

export const VerificationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { beat } = useScene();
  // Beats: 0 trust · 1 signed bundle · 2 run verify · 3 VERIFIED · 4 change a score · 5 FAILED · 6 browser proofs
  const introVis = windowed(frame, 0, beat(1) + 4, 12);
  const bundleVis = windowed(frame, beat(1), beat(2) + 4, 12);
  const termVis = windowed(frame, beat(2), beat(6) + 4, 12);
  const browserVis = progress(frame, beat(6), 14);
  const failAt = beat(5) - 4;
  const glitch = frame >= failAt && frame < failAt + 16;
  const jitter = glitch ? (rand(frame) - 0.5) * 24 : 0;

  const verifyOutAt = beat(2) + Math.ceil(CMD.length / 2.2) + 10;
  const rerunAt = beat(4) + 34;
  const lines: TermLine[] = [
    { at: beat(2) + 4, text: CMD, kind: "cmd", speed: 2.2 },
    { at: verifyOutAt, text: `OK   signature (key ${KEY})` },
    { at: verifyOutAt + 6, text: "OK   input fingerprint 05e7994c2a33…" },
    { at: verifyOutAt + 12, text: "OK   ranking re-computed from 123 reviews (max score difference 0)" },
    { at: beat(3) - 2, text: "VERIFIED: the published ranking follows from the published inputs.", kind: "ok" },
    { at: beat(4) + 2, text: "# change one criterion value in bundle.json", kind: "dim" },
    { at: rerunAt, text: CMD, kind: "cmd", speed: 3 },
    { at: failAt - 14, text: `OK   signature (key ${KEY})` },
    { at: failAt - 8, text: "FAIL input fingerprint 9c01b7e45f2d…" },
    { at: failAt - 2, text: "FAIL ranking re-computed from 123 reviews (max score difference 0.031)" },
    { at: failAt + 4, text: "results NOT verified", kind: "fail" },
  ];

  return (
    <SceneShell>
      <AbsoluteFill style={{ transform: `translateX(${jitter}px)` }}>
        {/* Publish */}
        <div style={{ opacity: introVis }}>
          <SectionTitle eyebrow="Tamper-evident results" title="Fairness is half the story." at={0} size={64} align="center" style={{ position: "absolute", left: 0, right: 0, top: 240 }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 420, textAlign: "center", ...rise(frame, 18, 16), fontFamily: fonts.serif, fontStyle: "italic", fontSize: 58, color: C.accent }}>
            The other half is trust.
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 580, display: "flex", justifyContent: "center" }}>
            <div
              style={{
                padding: "22px 44px",
                borderRadius: 14,
                background: C.accent,
                color: C.accentInk,
                fontFamily: fonts.sans,
                fontWeight: 600,
                fontSize: 30,
                letterSpacing: "0.04em",
                opacity: pop(frame, 30),
                transform: `scale(${frame > beat(1) - 14 && frame < beat(1) - 8 ? 0.94 : 1})`,
                boxShadow: `0 0 60px -10px ${C.glow}`,
              }}
            >
              PUBLISH RESULTS
            </div>
          </div>
        </div>
        <Sfx name="key" at={beat(1) - 14} volume={3} />

        {/* The signed bundle */}
        <div style={{ opacity: bundleVis }}>
          {PARTS.map((p, i) => {
            const enter = pop(frame, beat(1) + i * 6);
            const merge = progress(frame, beat(1) + 50 + i * 4, 18, ease);
            const x0 = 180;
            const y0 = 220 + i * 120;
            return (
              <div
                key={p.label}
                style={{
                  position: "absolute",
                  left: x0 + (1180 - x0) * merge,
                  top: y0 + (360 - y0) * merge,
                  width: 400,
                  padding: "18px 24px",
                  borderRadius: 14,
                  background: C.surface,
                  border: `1px solid ${C.lineStrong}`,
                  opacity: enter * (1 - merge),
                  transform: `scale(${1 - merge * 0.5})`,
                }}
              >
                <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, color: C.ink }}>{p.label}</div>
                <div style={{ fontFamily: fonts.mono, fontSize: 16, color: C.muted, marginTop: 4 }}>{p.sub}</div>
              </div>
            );
          })}
          <div
            style={{
              position: "absolute",
              left: 1080,
              top: 230,
              width: 600,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
              opacity: pop(frame, beat(1) + 60),
              transform: `scale(${0.85 + 0.15 * pop(frame, beat(1) + 60)})`,
            }}
          >
            <div style={{ filter: `drop-shadow(0 0 30px ${C.glow})` }}>
              <FileIcon size={190} color={C.accent} stroke={1.2} />
            </div>
            <div style={{ fontFamily: fonts.mono, fontWeight: 600, fontSize: 30, color: C.ink }}>SIGNED RESULTS BUNDLE</div>
            <div style={{ fontFamily: fonts.mono, fontSize: 18, color: C.accent }}>manifest signed with Ed25519</div>
          </div>
          <div style={{ position: "absolute", left: 170, top: 720, opacity: progress(frame, beat(1) + 30, 12) }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 15, letterSpacing: "0.16em", color: C.muted, marginBottom: 12 }}>HASH-CHAINED AUDIT LOG</div>
            <AuditChain entries={CHAIN} at={beat(1) + 30} stagger={5} />
          </div>
        </div>
        <Sfx name="whoosh" at={beat(1) + 50} volume={0.6} />
        <Sfx name="impact" at={beat(1) + 60} volume={0.4} />

        {/* Verify, tamper, verify again */}
        <div style={{ opacity: termVis }}>
          <div style={{ position: "absolute", left: 120, top: 160 }}>
            <TerminalWindow lines={lines} width={1060} height={560} fontSize={19} title="anyone's laptop · offline" />
          </div>
          {/* the edited value */}
          <div
            style={{
              position: "absolute",
              left: 1240,
              top: 170,
              width: 540,
              padding: 24,
              borderRadius: 14,
              background: "#070a0a",
              border: `1px solid ${C.lineStrong}`,
              fontFamily: fonts.mono,
              fontSize: 19,
              lineHeight: 1.7,
              color: C.ink2,
              opacity: windowed(frame, beat(4), beat(6), 10),
            }}
          >
            <div style={{ color: C.muted, fontSize: 15, marginBottom: 8 }}>bundle.json</div>
            <div>{'{ "judge": "J-3f9c…",'}</div>
            <div>{'  "project": "prj_11",'}</div>
            <div>
              {'  "values": { "quality": '}
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: frame >= beat(4) + 18 ? `${C.warn}33` : "transparent",
                  color: frame >= beat(4) + 18 ? C.warn : C.ink2,
                }}
              >
                {frame >= beat(4) + 18 ? "5" : "3"}
              </span>
              {" } }"}
            </div>
          </div>
          <div style={{ position: "absolute", left: 1250, top: 470 }}>
            {frame < failAt ? (
              <VerificationBadge ok at={beat(3) - 2} size={120} label="VERIFIED" />
            ) : (
              <div
                style={{
                  transform: glitch ? `translate(${(rand(frame * 3) - 0.5) * 30}px, ${(rand(frame * 7) - 0.5) * 10}px)` : "none",
                  filter: glitch ? `drop-shadow(${(rand(frame) - 0.5) * 16}px 0 0 #00e5ff) drop-shadow(${(rand(frame + 1) - 0.5) * 16}px 0 0 #ff2bd6)` : "none",
                }}
              >
                <VerificationBadge ok={false} at={failAt} size={110} label="FAILED" />
              </div>
            )}
          </div>
          <div style={{ position: "absolute", left: 1250, top: 640, width: 520, fontFamily: fonts.sans, fontSize: 24, lineHeight: 1.4, color: C.ink2, opacity: progress(frame, beat(3) + 10, 14) }}>
            Signature checked. Inputs fingerprinted. The exact engine re-run — by anyone, offline.
          </div>
        </div>
        <Sfx name="success" at={beat(3) - 2} />
        <Sfx name="glitch" at={failAt} />
        <Sfx name="deny" at={failAt + 2} volume={0.7} />

        {/* Per-review proofs in the browser */}
        <div style={{ opacity: browserVis }}>
          <SectionTitle eyebrow="Judge records" title="Prove your own reviews in the browser." at={beat(6)} size={52} style={{ position: "absolute", left: 140, top: 110 }} />
          <div style={{ position: "absolute", left: 140, top: 280, ...rise(frame, beat(6) + 4, 30) }}>
            <BrowserWindow url="localhost:8080/verify" width={880} height={420}>
              <MockScreen screen="verify" />
            </BrowserWindow>
          </div>
          <div style={{ position: "absolute", left: 1120, top: 300 }}>
            <Merkle at={beat(6) + 10} />
          </div>
        </div>
      </AbsoluteFill>

      {/* glitch slices */}
      {glitch
        ? Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: rand(frame * 11 + i) * 1000,
                height: 6 + rand(frame + i * 5) * 30,
                background: i % 2 ? "rgba(255,95,109,0.25)" : "rgba(0,229,255,0.12)",
                transform: `translateX(${(rand(frame * 13 + i) - 0.5) * 120}px)`,
              }}
            />
          ))
        : null}
      {frame >= failAt && frame < failAt + 6 ? <AbsoluteFill style={{ background: "rgba(255,95,109,0.12)" }} /> : null}
    </SceneShell>
  );
};
