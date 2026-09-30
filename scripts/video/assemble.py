"""Assemble the demo video: title card + live app footage + closing card,
Gemini-TTS voiceover, burned-in captions. Output: submission/UNHEARD-demo.mp4

    backend/.venv/Scripts/python scripts/video/assemble.py submission/video-build
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
FF = imageio_ffmpeg.get_ffmpeg_exe()
APP_SEGMENTS = ["s01_intro", "s02_demand", "s03_capture", "s04_commit", "s05_reveal", "s06_dossier", "s07_explain",
                "s08_whatif", "s09_brief", "s10_ask"]
FPS = 30


def run(args: list[str]) -> None:
    r = subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-2000:])


def wav_len(p: Path) -> float:
    with wave.open(str(p), "rb") as w:
        return w.getnframes() / w.getframerate()


def ass_time(t: float) -> str:
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def main() -> None:
    build = Path(sys.argv[1])
    tl = json.loads((build / "timeline.json").read_text())
    tempo = tl["tempo"]
    narr = {s["id"]: s["text"] for s in json.loads((Path(__file__).parent / "narration.json").read_text(encoding="utf-8"))["segments"]}
    segs = {s["id"]: s for s in tl["segments"]}
    frames = tl["frames"]
    audio_len = {k: wav_len(build / "audio" / f"{k}.wav") / tempo for k in narr}

    title_len = audio_len["s00_title"] + 1.2
    close_len = audio_len["s12_close"] + 2.0
    t0 = segs[APP_SEGMENTS[0]]["start"]
    t1 = segs[APP_SEGMENTS[-1]]["end"]
    app_len = t1 - t0

    # ---------------------------------------------------------------- app footage (VFR frames -> CFR video)
    lst = build / "frames.txt"
    usable = [f for f in frames if f["t"] <= t1]
    # frame shown at t0 = last frame at or before t0
    start_idx = max(i for i, f in enumerate(usable) if f["t"] <= t0) if any(f["t"] <= t0 for f in usable) else 0
    usable = usable[start_idx:]
    lines = []
    for i, f in enumerate(usable):
        a = max(f["t"], t0)
        b = usable[i + 1]["t"] if i + 1 < len(usable) else t1
        d = max(0.0, b - a)
        if d <= 0:
            continue
        lines.append(f"file 'frames/{f['file']}'\nduration {d:.4f}")
    lines.append(f"file 'frames/{usable[-1]['file']}'")
    lst.write_text("\n".join(lines) + "\n")
    run(["-f", "concat", "-safe", "0", "-i", str(lst), "-vf", f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", str(build / "app.mp4")])

    # ---------------------------------------------------------------- cards (still images -> clips with fades)
    for name, length in (("title", title_len), ("close", close_len)):
        png = build / f"{name}.png"
        run(["-loop", "1", "-i", str(png), "-t", f"{length:.3f}", "-vf",
             f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.8,fade=t=out:st={length - 0.8:.3f}:d=0.8",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", str(build / f"{name}.mp4")])
    (build / "parts.txt").write_text("file 'title.mp4'\nfile 'app.mp4'\nfile 'close.mp4'\n")
    run(["-f", "concat", "-safe", "0", "-i", str(build / "parts.txt"), "-c", "copy", str(build / "video.mp4")])

    # ---------------------------------------------------------------- voiceover timeline
    placements: list[tuple[str, float]] = [("s00_title", 0.6)]
    for sid in APP_SEGMENTS:
        placements.append((sid, title_len + (segs[sid]["start"] - t0) + 0.3))
    placements.append(("s12_close", title_len + app_len + 0.6))
    inputs: list[str] = []
    chains: list[str] = []
    for i, (sid, at) in enumerate(placements):
        inputs += ["-i", str(build / "audio" / f"{sid}.wav")]
        chains.append(f"[{i}:a]aresample=48000,atempo={tempo},adelay={int(at * 1000)}|{int(at * 1000)}[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(placements)))
    total = title_len + app_len + close_len
    chains.append(f"{mix}amix=inputs={len(placements)}:normalize=0,apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[out]")
    run([*inputs, "-filter_complex", ";".join(chains), "-map", "[out]", "-ac", "2", "-ar", "48000", str(build / "voice.wav")])

    # ---------------------------------------------------------------- captions (ASS), sentence-timed by length
    ev = []
    for sid, at in placements:
        text = narr[sid]
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        dur = audio_len[sid]
        chars = sum(len(s) for s in sentences)
        t = at
        for s in sentences:
            d = dur * len(s) / chars
            ev.append(f"Dialogue: 0,{ass_time(t)},{ass_time(t + d - 0.05)},Cap,,0,0,0,,{s}")
            t += d
    ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Segoe UI,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H9E000000,0,0,0,0,100,100,0,0,3,14,0,2,260,260,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "\n".join(ev) + "\n"
    (build / "captions.ass").write_text(ass, encoding="utf-8")

    # ---------------------------------------------------------------- final mux + burn captions
    out = ROOT / "submission" / "UNHEARD-demo.mp4"
    # subtitles filter path must be escaped for ffmpeg on Windows: run from the build dir with a relative name
    r = subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", "video.mp4", "-i", "voice.wav", "-vf", "subtitles=captions.ass",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                        "-movflags", "+faststart", "-shortest", str(out)], cwd=build, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-2000:])
    print(f"wrote {out}  length {total:.1f}s ({int(total // 60)}:{int(total % 60):02d})")


if __name__ == "__main__":
    main()
