"""Synthesize the video's sound effects and music bed. Standard library only.

Everything is generated from oscillators and seeded noise, so there are no
third-party or copyrighted samples. Replace any file in public/sfx or
public/music with your own sound of the same name to upgrade it.

Usage: python scripts/generate_sfx.py
"""

import array
import math
import pathlib
import random
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
SFX = ROOT / "public" / "sfx"
MUSIC = ROOT / "public" / "music"
SR = 44100
rng = random.Random(7)
TAU = 2 * math.pi


def write(path: pathlib.Path, samples: list[float], sr: int = SR, gain: float = 0.9) -> None:
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = gain / peak * 32767
    data = array.array("h", (int(max(-32767, min(32767, s * scale))) for s in samples))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())
    print(f"  {path.relative_to(ROOT)}  {len(samples) / sr:.2f}s")


def n(seconds: float) -> int:
    return int(seconds * SR)


def lowpass(xs: list[float], cutoff) -> list[float]:
    """One-pole low-pass; cutoff may be a function of the sample index."""
    out, y = [], 0.0
    for i, x in enumerate(xs):
        c = cutoff(i) if callable(cutoff) else cutoff
        a = 1 - math.exp(-TAU * c / SR)
        y += a * (x - y)
        out.append(y)
    return out


def noise(count: int) -> list[float]:
    return [rng.uniform(-1, 1) for _ in range(count)]


def whoosh() -> list[float]:
    L = n(0.75)
    src = noise(L)
    sweep = lambda i: 300 + 5200 * math.sin(math.pi * i / L) ** 2  # noqa: E731
    f = lowpass(src, sweep)
    return [s * math.sin(math.pi * i / L) ** 1.5 for i, s in enumerate(f)]


def impact() -> list[float]:
    L = n(1.8)
    out, phase = [], 0.0
    hit = lowpass(noise(L), 1800)
    for i in range(L):
        t = i / SR
        freq = 38 + 34 * math.exp(-t * 9)
        phase += TAU * freq / SR
        body = math.sin(phase) * math.exp(-t * 2.6)
        click = hit[i] * math.exp(-t * 40) * 0.8
        tail = hit[i] * math.exp(-t * 3.5) * 0.12
        out.append(body + click + tail)
    return out


def tone(freq: float, seconds: float, decay: float, harmonics=((1, 1.0),)) -> list[float]:
    L = n(seconds)
    return [
        sum(a * math.sin(TAU * freq * h * i / SR) for h, a in harmonics) * math.exp(-decay * i / SR)
        for i in range(L)
    ]


def mix(*parts: tuple[float, list[float]]) -> list[float]:
    L = max(n(at) + len(p) for at, p in parts)
    out = [0.0] * L
    for at, p in parts:
        o = n(at)
        for i, s in enumerate(p):
            out[o + i] += s
    return out


def tick() -> list[float]:
    return tone(2400, 0.05, 120)


def key() -> list[float]:
    L = n(0.035)
    f = lowpass(noise(L), 3500)
    return [s * math.exp(-i / SR * 160) for i, s in enumerate(f)]


def pop() -> list[float]:
    L = n(0.14)
    out, ph = [], 0.0
    for i in range(L):
        t = i / SR
        ph += TAU * (720 - 1900 * t) / SR
        out.append(math.sin(ph) * math.exp(-t * 32))
    return out


def deny() -> list[float]:
    sq = ((1, 1.0), (3, 0.33), (5, 0.18))
    a = tone(233, 0.2, 6, sq)
    b = tone(175, 0.34, 7, sq)
    thump = tone(60, 0.3, 14)
    return mix((0, a), (0.2, b), (0.0, thump))


def success() -> list[float]:
    bell = ((1, 1.0), (2.01, 0.25), (3.02, 0.08))
    return mix((0, tone(880, 1.0, 4.5, bell)), (0.11, tone(1318.5, 1.1, 4, bell)))


def ping() -> list[float]:
    bell = ((1, 1.0), (2.76, 0.3), (5.4, 0.1))
    return mix((0, tone(1567.98, 1.4, 3.2, bell)), (0, tone(784, 1.2, 5)))


def lock() -> list[float]:
    c1 = key()
    thunk = tone(110, 0.25, 22, ((1, 1.0), (2, 0.3)))
    return mix((0, c1), (0.07, c1), (0.07, thunk))


def glitch() -> list[float]:
    L = n(0.8)
    out, i = [0.0] * L, 0
    while i < L:
        seg = rng.randint(n(0.015), n(0.07))
        kind = rng.random()
        freq = rng.choice([90, 140, 220, 440, 880, 1760])
        for k in range(i, min(L, i + seg)):
            if kind < 0.4:
                s = 1.0 if math.sin(TAU * freq * k / SR) > 0 else -1.0
            elif kind < 0.75:
                s = rng.uniform(-1, 1)
            else:
                s = 0.0
            out[k] = round(s * 4) / 4 * (1 - k / L) ** 0.6
        i += seg
    return out


def riser() -> list[float]:
    L = n(2.2)
    src = noise(L)
    f = lowpass(src, lambda i: 200 + 6000 * (i / L) ** 2)
    out, ph = [], 0.0
    for i, s in enumerate(f):
        t = i / L
        ph += TAU * (180 + 620 * t * t) / SR
        out.append((s * 0.8 + math.sin(ph) * 0.35) * t**2.2)
    return out


def music_bed() -> list[float]:
    """A slow ambient pad, A minor → F → C → G, that loops seamlessly."""
    sr = 22050
    chord_len = 10.0
    chords = [
        [110.0, 164.81, 220.0, 261.63, 329.63],
        [87.31, 130.81, 174.61, 220.0, 261.63],
        [130.81, 196.0, 261.63, 329.63, 392.0],
        [98.0, 146.83, 196.0, 246.94, 293.66],
    ]
    total = int(sr * chord_len * len(chords))
    out = [0.0] * total
    fade = 3.0
    for ci, notes in enumerate(chords):
        start = int(sr * (ci * chord_len - fade / 2))
        length = int(sr * (chord_len + fade))
        incs = [(TAU * f * d / sr, a) for f in notes for d, a in ((1.0, 1.0), (1.003, 0.6), (2.0, 0.12))]
        phases = [rng.uniform(0, TAU) for _ in incs]
        for k in range(length):
            t = k / sr
            env = min(1.0, t / fade, (chord_len + fade - t) / fade)
            env = 0.5 - 0.5 * math.cos(math.pi * max(0.0, env))
            s = 0.0
            for j, (inc, a) in enumerate(incs):
                s += a * math.sin(phases[j] + inc * k)
            trem = 0.85 + 0.15 * math.sin(TAU * 0.11 * t + ci)
            out[(start + k) % total] += s * env * trem
    # Soften the top end so it sits under the voice.
    smooth, y = [], 0.0
    a = 1 - math.exp(-TAU * 1400 / sr)
    for x in out:
        y += a * (x - y)
        smooth.append(y)
    return smooth


def main() -> None:
    effects = {
        "whoosh": whoosh, "impact": impact, "tick": tick, "key": key, "pop": pop,
        "deny": deny, "success": success, "ping": ping, "lock": lock,
        "glitch": glitch, "riser": riser,
    }
    for name, fn in effects.items():
        write(SFX / f"{name}.wav", fn())
    write(MUSIC / "bed.wav", music_bed(), sr=22050, gain=0.8)


if __name__ == "__main__":
    main()
