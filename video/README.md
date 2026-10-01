# Dogfood Judge — submission video

A 4:46, 1920×1080, 30 fps Remotion video. It is narrated, captioned, and has
the presenter badge in the bottom-right corner of every scene. Everything is
generated from code: voice, music, sound effects and visuals. There are no
third-party or copyrighted assets.

**Core idea:** *Hackathon results should not just produce a winner. They
should produce a winner you can defend.*

## Commands

```bash
cd video
npm install
npm run dev            # Remotion Studio: full video plus one composition per scene
npm run render         # final MP4 → out/dogfood-judge.mp4
npm run render:draft   # half-resolution preview render
```

To regenerate audio (only needed if you edit the script or swap voices):

```bash
pip install edge-tts
python scripts/generate_voice.py     # voice → public/voice/, timings → src/voice-manifest.json, public/captions.srt
python scripts/generate_sfx.py       # sound effects + music bed (standard library only)
```

Final MP4 settings (`remotion.config.ts`): H.264, CRF 18, yuv420p, AAC at 320 kbps.

## How it fits together

```
src/narration.json ──► scripts/generate_voice.py ──► public/voice/*.mp3
        │                                         └► src/voice-manifest.json (speech length per line)
        ▼
src/lib/timeline.ts  (scene + line timings, in frames)
        │
        ├─► Video.tsx: scenes in <Sequence>s, voice clips, ducked music bed
        ├─► scenes/*: animations keyed to useScene().beat(i), the frame where line i starts
        └─► overlays: Captions, PresenterBadge (speaking ring), ChapterLabel
```

The script drives the timing. If you change a sentence and regenerate the
voice, every scene re-times itself and the visuals stay locked to the words.

| Path | What it is |
| --- | --- |
| `src/narration.json` | The voiceover: lines per scene, pauses, and caption text (`text`, for when the written form differs from the spoken one) |
| `src/scenes/` | 13 scenes, from `IntroScene` to `FinalScene` |
| `src/components/` | Reusable parts: BrowserWindow, TerminalWindow, Leaderboard, JudgeCard, ScoreCard, AnimatedNumber, SectionTitle, MetricBadge, FlowArrow, CodeCommand, VerificationBadge, ProbabilityBar, RankInterval, AuditChain, ProjectComparison, MockScreens |
| `src/lib/data.ts` | Fixture numbers. Every claim comes from JUDGING.md or the reports |
| `src/lib/audio.ts` | Mix levels: voice, music, music ducking, sound effects |
| `src/lib/assets.ts` | Optional real screenshots (see below) |
| `VOICEOVER.md` | The full narration with timestamps |
| `public/captions.srt` | Subtitles for YouTube or Devpost uploads |

## Customizing

- **Your own voice.** Record each line as `public/voice/<scene>-<n>.mp3`,
  using the same names as the generated files. Then run
  `python scripts/generate_voice.py --measure-only` to re-time the video to
  your recording.
- **A different TTS voice.** Run
  `python scripts/generate_voice.py --voice en-US-AndrewNeural --force`, or
  change `voice` and `rate` in `narration.json`.
- **Real screenshots.** Capture them at 1600×900 from `docker compose up` and
  put them in `public/screenshots/`. Then list them in `src/lib/assets.ts`,
  which also says which URL to capture for each screen. Browser frames show
  them in place of the built-in mock UI.
- **Music.** Replace `public/music/bed.wav` with a licensed track that has
  the same name. Change its level in `src/lib/audio.ts`.
- **Captions or badge off.** Use the Studio props panel to set
  `captions: false` or `presenter: false`, or pass `--props='{"captions":false,"presenter":true}'`
  on the command line.
- **Review stills.** Run `node scripts/stills.mjs 05-defensible 0.2 0.5 0.9`
  to render frames at fractions of a scene.

## Accuracy notes

Every number is one the product actually prints on the DOGFOOD fixture:
24/30 refits, removing any one of 6 judges flips first place, a 0.05 SE lead,
P(top 3) = 51%, a rank interval of 1–6, jdg_24 most influential at τ = 0.78,
jdg_07 flat, the 44-case matrix, T3 11/11, T4 9/9 and bonus 4/4.

A few things are illustrative, and the video labels them on screen:

- **The #19 → #29 review** is the planted rogue review from the judging unit
  test. On the fixture, no review crosses 2.5σ.
- **The normalization reorder** uses an example event where leniency is real.
  On the fixture, the correction is small (README, "Honest limitations").
- **The `go test` timings** are representative.
