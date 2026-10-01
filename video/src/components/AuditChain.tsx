import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { pop, progress } from "../lib/anim";
import { C, fonts } from "../lib/theme";

export type ChainEntry = { action: string; hash: string };

/**
 * The hash-chained audit log: each entry carries the previous entry's hash,
 * drawn as linked blocks. `broken` marks an entry whose link no longer holds.
 */
export const AuditChain: React.FC<{
  entries: ChainEntry[];
  at: number;
  stagger?: number;
  broken?: number;
  brokenAt?: number;
  style?: CSSProperties;
}> = ({ entries, at, stagger = 6, broken, brokenAt = Number.POSITIVE_INFINITY, style }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", alignItems: "center", ...style }}>
      {entries.map((e, i) => {
        const s = pop(frame, at + i * stagger);
        const isBroken = broken !== undefined && i >= broken && frame >= brokenAt;
        const color = isBroken ? C.bad : C.accent;
        const link = progress(frame, at + i * stagger + 4, 8);
        return (
          <div key={e.hash} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 ? (
              <div
                style={{
                  width: 34,
                  height: 2,
                  background: isBroken && i === broken ? "transparent" : `${color}aa`,
                  borderTop: isBroken && i === broken ? `2px dashed ${C.bad}` : "none",
                  transform: `scaleX(${link})`,
                  transformOrigin: "left",
                }}
              />
            ) : null}
            <div
              style={{
                width: 170,
                padding: "12px 14px",
                borderRadius: 10,
                background: C.surface,
                border: `1px solid ${isBroken ? `${C.bad}aa` : C.lineStrong}`,
                opacity: s,
                transform: `translateY(${(1 - s) * 16}px)`,
              }}
            >
              <div style={{ fontFamily: fonts.mono, fontSize: 13, color: C.muted }}>#{String(i + 1).padStart(3, "0")}</div>
              <div style={{ fontFamily: fonts.sans, fontSize: 17, fontWeight: 500, color: C.ink, whiteSpace: "nowrap" }}>
                {e.action}
              </div>
              <div style={{ fontFamily: fonts.mono, fontSize: 13, color }}>{e.hash}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
