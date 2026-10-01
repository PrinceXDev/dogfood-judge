"""Generate the voiceover, one MP3 per narration line, from src/narration.json.

Writes public/voice/<scene>-<n>.mp3 and src/voice-manifest.json (line
durations in seconds). The video's timeline is built from that manifest, so
scenes always fit the narration. Unchanged lines are skipped, so editing one
sentence only re-synthesizes that sentence.

Usage:
  pip install edge-tts
  python scripts/generate_voice.py                 # voice from narration.json
  python scripts/generate_voice.py --voice en-US-AndrewNeural --force

To use your own recorded voice instead, drop MP3s with the same names into
public/voice/ and run with --measure-only to refresh the durations.
"""

import argparse
import asyncio
import hashlib
import json
import math
import pathlib
import re
import shutil
import struct
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
NARRATION = ROOT / "src" / "narration.json"
MANIFEST = ROOT / "src" / "voice-manifest.json"
VOICE_DIR = ROOT / "public" / "voice"

# MPEG-1/2 Layer III bitrate tables (kbps) and sample rates, for duration probing.
_BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_duration(path: pathlib.Path) -> float:
    """Sum MP3 frame durations. No ffmpeg needed; works for CBR and VBR."""
    data = path.read_bytes()
    i, total = 0, 0.0
    if data[:3] == b"ID3":
        size = data[6:10]
        i = 10 + ((size[0] << 21) | (size[1] << 14) | (size[2] << 7) | size[3])
    while i + 4 <= len(data):
        (h,) = struct.unpack(">I", data[i : i + 4])
        if (h >> 21) & 0x7FF != 0x7FF:
            i += 1
            continue
        ver_bits = (h >> 19) & 3
        br_idx = (h >> 12) & 0xF
        sr_idx = (h >> 10) & 3
        if ver_bits == 1 or br_idx in (0, 15) or sr_idx == 3:
            i += 1
            continue
        mpeg = 1 if ver_bits == 3 else 2
        bitrate = _BITRATES[mpeg][br_idx] * 1000
        rate = _RATES[ver_bits][sr_idx]
        padding = (h >> 9) & 1
        samples = 1152 if mpeg == 1 else 576
        frame_len = (samples // 8 * bitrate) // rate + padding
        if frame_len <= 0:
            break
        total += samples / rate
        i += frame_len
    return round(total, 3)


FFMPEG = ROOT / "node_modules" / "@remotion" / "compositor-win32-x64-msvc" / "ffmpeg.exe"
SILENCE = re.compile(r"silence_(start|end): ([0-9.]+)")


def speech_bounds(path: pathlib.Path, total: float) -> tuple[float, float]:
    """Where speech starts and ends inside the clip (TTS pads both sides).

    Uses the ffmpeg that ships with Remotion; falls back to the whole clip."""
    exe = shutil.which("ffmpeg") or (str(FFMPEG) if FFMPEG.exists() else None)
    if not exe:
        return 0.0, total
    log = subprocess.run(
        [exe, "-hide_banner", "-i", str(path), "-af", "silencedetect=noise=-45dB:d=0.08", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    events = [(k, float(v)) for k, v in SILENCE.findall(log)]
    start, end = 0.0, total
    if events and events[0] == ("start", 0.0) and len(events) > 1:
        start = events[1][1]
    # ffmpeg closes a trailing silence with silence_end at EOF; drop that.
    if events and events[-1][0] == "end" and events[-1][1] >= total - 0.05:
        events = events[:-1]
    if events and events[-1][0] == "start" and events[-1][1] > start:
        end = events[-1][1]
    # Keep a breath of room so consonants are not clipped.
    return max(0.0, start - 0.06), min(total, end + 0.12)


def line_key(voice: str, rate: str, say: str) -> str:
    return hashlib.sha1(f"{voice}|{rate}|{say}".encode()).hexdigest()[:12]


async def synth(text: str, voice: str, rate: str, out: pathlib.Path) -> None:
    import edge_tts  # imported lazily so --measure-only works without it

    await edge_tts.Communicate(text, voice, rate=rate).save(str(out))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice")
    ap.add_argument("--rate")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--measure-only", action="store_true")
    args = ap.parse_args()

    narration = json.loads(NARRATION.read_text(encoding="utf-8"))
    voice = args.voice or narration["voice"]
    rate = args.rate or narration.get("rate", "+0%")
    old = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    old_lines = old.get("lines", {})
    VOICE_DIR.mkdir(parents=True, exist_ok=True)

    lines = {}
    for scene in narration["scenes"]:
        for n, line in enumerate(scene["lines"]):
            name = f"{scene['id']}-{n}"
            out = VOICE_DIR / f"{name}.mp3"
            key = line_key(voice, rate, line["say"])
            fresh = out.exists() and old_lines.get(name, {}).get("key") == key
            if not args.measure_only and (args.force or not fresh):
                print(f"  synth {name}: {line['say'][:60]}")
                await synth(line["say"], voice, rate, out)
            if not out.exists():
                raise SystemExit(f"missing {out}")
            start, end = speech_bounds(out, mp3_duration(out))
            lines[name] = {"key": key, "offset": round(start, 3), "seconds": round(end - start, 3)}

    MANIFEST.write_text(
        json.dumps({"voice": voice, "rate": rate, "lines": lines}, indent=2) + "\n",
        encoding="utf-8",
    )
    total = sum(v["seconds"] for v in lines.values())
    print(f"{len(lines)} lines, {total:.1f}s of speech -> {MANIFEST.relative_to(ROOT)}")
    frames = write_captions(narration, lines)
    print(f"video length {frames / FPS:.1f}s -> {CAPTIONS.relative_to(ROOT)}")


# Must match src/lib/timeline.ts so the .srt lands on the same frames.
FPS = 30
DEFAULT_PAUSE = 0.32
CAPTIONS = ROOT / "public" / "captions.srt"


def _srt_time(frame: int) -> str:
    ms = round(frame * 1000 / FPS)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def write_captions(narration: dict, lines: dict) -> int:
    f = lambda sec: round(sec * FPS)  # noqa: E731
    cues, cursor = [], 0
    for scene in narration["scenes"]:
        c = f(scene["lead"])
        for n, line in enumerate(scene["lines"]):
            dur = math.ceil(lines[f"{scene['id']}-{n}"]["seconds"] * FPS)
            cues.append((cursor + c, cursor + c + dur, line.get("text", line["say"])))
            c += dur + f(line.get("pause", DEFAULT_PAUSE))
        cursor += c + f(scene["tail"])
    out = []
    for i, (a, b, text) in enumerate(cues, 1):
        out.append(f"{i}\n{_srt_time(a)} --> {_srt_time(b)}\n{text}\n")
    CAPTIONS.write_text("\n".join(out), encoding="utf-8")
    return cursor


if __name__ == "__main__":
    asyncio.run(main())
