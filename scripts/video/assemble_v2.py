"""Voice-first assembly: every narration line starts exactly on its on-screen
event; idle screen time is trimmed (never actions); short crossfades hide cuts;
no captions; voice at natural speed. Output: submission/UNHEARD-demo.mp4

    backend/.venv/Scripts/python scripts/video/assemble_v2.py <build>
"""
from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FF = imageio_ffmpeg.get_ffmpeg_exe()
FPS = 30
GAP_AFTER_LINE = 0.55  # breath after each line
CLICK_OFFSET = 1.3  # AI-wait cues: click happens ~1.3 s after the cue starts
RESULT_TAIL = 1.1  # keep this much before an AI result appears
XFADE = 8  # frames of crossfade at trimmed cuts
LEAD_IN = 0.7  # black fade-in before first line
CLOSE_TAIL = 1.8


def run(args, cwd=None):
    r = subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True, cwd=cwd)
    if r.returncode:
        raise SystemExit(r.stderr[-2000:])


def main() -> None:
    build = Path(sys.argv[1])
    rec = json.loads((build / "cues.json").read_text())
    lines = json.loads((build / "voice" / "lines.json").read_text(encoding="utf-8"))
    frames = rec["frames"]
    cues = rec["cues"]
    by = {c["name"]: c for c in cues}
    order = [c["name"] for c in cues]
    t_end = by["end"]["t"]

    # ---------------------------------------------------------------- idle intervals (safe to trim)
    idle: list[tuple[float, float]] = []
    for c, nxt in zip(cues, cues[1:]):
        if c["wait"]:
            a, b = c["t"] + CLICK_OFFSET + 0.6, nxt["t"] - RESULT_TAIL
        else:
            a, b = c["settle"] + 0.6, nxt["t"]  # keep 0.6 s to let the result land
        if b - a > 0.3:
            idle.append((a, b))

    def anchor(line):
        c = by[line["cue"]]
        return {"t": c["t"], "settle": c["settle"], "settle_click": c["t"] + CLICK_OFFSET}[line["at"]]

    app_lines = [l for l in lines if l["cue"] != "close"]
    close_line = next(l for l in lines if l["cue"] == "close")
    anchors = [anchor(l) for l in app_lines]
    assert anchors == sorted(anchors), "narration anchors must be in time order"
    starts = [cues[0]["t"]] + anchors[1:]  # first block starts at the very beginning
    ends = anchors[1:] + [t_end]

    # ---------------------------------------------------------------- edit decision list
    pieces = []  # ("play", a, b) | ("hold", t, dur)
    line_out: list[float] = []
    out_t = LEAD_IN
    for i, (a, b) in enumerate(zip(starts, ends)):
        need = app_lines[i]["seconds"] + GAP_AFTER_LINE
        if i == 0:
            need += 0.4
        L = b - a
        cuttable = [(max(a, x), min(b, y)) for x, y in idle if min(b, y) - max(a, x) > 0.05]
        can_cut = sum(y - x for x, y in cuttable)
        line_out.append(out_t + (0.4 if i == 0 else 0.12))
        if L > need and can_cut > 0.05:
            cut = min(L - need, can_cut)
            # remove from the END of each idle window (latest first), keeping the start where results land
            removed = []
            for x, y in reversed(cuttable):
                if cut <= 0:
                    break
                take = min(cut, y - x)
                removed.append((y - take, y))
                cut -= take
            removed.sort()
            cur = a
            for x, y in removed:
                if x > cur:
                    pieces.append(("play", cur, x))
                cur = y
            if b > cur:
                pieces.append(("play", cur, b))
            out_len = L - sum(y - x for x, y in removed)
        else:
            pieces.append(("play", a, b))
            out_len = L
            if need > L:
                # extend on a static moment: the end of the last idle window, else the block end
                hold_at = max([y for x, y in cuttable], default=b)
                idx = next((k for k in range(len(pieces) - 1, -1, -1) if pieces[k][0] == "play" and pieces[k][1] <= hold_at <= pieces[k][2]), None)
                if idx is not None and hold_at < b:
                    kind, pa, pb = pieces[idx]
                    pieces[idx:idx + 1] = [("play", pa, hold_at), ("hold", hold_at, need - L), ("play", hold_at, pb)]
                else:
                    pieces.append(("hold", b, need - L))
                out_len = need
        out_t += out_len
    app_len = out_t - LEAD_IN

    # ---------------------------------------------------------------- frames (30 fps) with crossfades at cuts
    ts = [f["t"] for f in frames]

    def frame_at(t: float) -> str:
        import bisect
        k = max(0, bisect.bisect_right(ts, t) - 1)
        return frames[k]["file"]

    seq: list[tuple[str, float]] = []  # (frame file, rec time) per output frame
    prev_end = None
    for p in pieces:
        if p[0] == "play":
            _, a, b = p
            n = max(1, round((b - a) * FPS))
            seq += [(frame_at(a + k / FPS), a + k / FPS) for k in range(n)]
        else:
            _, t, d = p
            n = max(1, round(d * FPS))
            seq += [(frame_at(t), t)] * n
        prev_end = p
    # detect discontinuities (trim points) and crossfade across them
    xdir = build / "xfade"
    xdir.mkdir(exist_ok=True)
    out_files: list[str] = [f"frames/{f}" for f, _ in seq]
    for k in range(1, len(seq)):
        jump = seq[k][1] - seq[k - 1][1]
        if jump > 0.5:  # a trimmed gap
            before = Image.open(build / "frames" / seq[k - 1][0]).convert("RGB")
            for j in range(XFADE):
                idx = k + j
                if idx >= len(seq):
                    break
                after = Image.open(build / "frames" / seq[idx][0]).convert("RGB").resize(before.size)
                blended = Image.blend(before, after, (j + 1) / (XFADE + 1))
                name = f"x_{idx:06d}.jpg"
                blended.save(xdir / name, quality=92)
                out_files[idx] = f"xfade/{name}"

    # lead-in (black) + app frames as a concat list
    black = build / "black.jpg"
    Image.new("RGB", Image.open(build / "frames" / seq[0][0]).size, (0, 0, 0)).save(black)
    lst = [f"file 'black.jpg'\nduration {LEAD_IN:.4f}"]
    run_len = 1
    for k in range(len(out_files)):
        if k + 1 < len(out_files) and out_files[k + 1] == out_files[k]:
            run_len += 1
            continue
        lst.append(f"file '{out_files[k]}'\nduration {run_len / FPS:.5f}")
        run_len = 1
    lst.append(f"file '{out_files[-1]}'")
    (build / "edit.txt").write_text("\n".join(lst) + "\n")
    run(["-f", "concat", "-safe", "0", "-i", "edit.txt", "-vf",
         f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p,fade=t=in:st=0:d={LEAD_IN}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "17", "app_v2.mp4"], cwd=build)

    # closing card
    close_len = close_line["seconds"] + CLOSE_TAIL + 0.8
    run(["-loop", "1", "-i", "close.png", "-t", f"{close_len:.3f}", "-vf",
         f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st={close_len - 1.0:.3f}:d=1.0",
         "-c:v", "libx264", "-preset", "medium", "-crf", "17", "close_v2.mp4"], cwd=build)
    (build / "parts_v2.txt").write_text("file 'app_v2.mp4'\nfile 'close_v2.mp4'\n")
    run(["-f", "concat", "-safe", "0", "-i", "parts_v2.txt", "-c", "copy", "video_v2.mp4"], cwd=build)

    # ---------------------------------------------------------------- voice track (natural speed, no stretching)
    total = LEAD_IN + app_len + close_len
    placements = list(zip(app_lines, line_out)) + [(close_line, LEAD_IN + app_len + 0.6)]
    inputs, chains = [], []
    for i, (l, at) in enumerate(placements):
        inputs += ["-i", str(build / "voice" / f"line_{l['i']:02d}.wav")]
        ms = int(at * 1000)
        chains.append(f"[{i}:a]aresample=48000,afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse,adelay={ms}|{ms}[a{i}]")
    chains.append("".join(f"[a{i}]" for i in range(len(placements))) + f"amix=inputs={len(placements)}:normalize=0,apad,atrim=0:{total:.3f},"
                  "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=9[out]")
    run([*inputs, "-filter_complex", ";".join(chains), "-map", "[out]", "-ac", "2", "-ar", "48000", str(build / "voice_v2.wav")])

    out = ROOT / "submission" / "UNHEARD-demo.mp4"
    run(["-i", "video_v2.mp4", "-i", "voice_v2.wav", "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", "-shortest", str(out)], cwd=build)

    sync = [{"line": l["i"], "cue": l["cue"], "out_start": round(at, 2), "seconds": l["seconds"]} for l, at in placements]
    (build / "sync_v2.json").write_text(json.dumps({"pieces": pieces, "lines": sync, "total": total}, indent=1))
    print(f"wrote {out}  {total:.1f}s ({int(total // 60)}:{int(total % 60):02d}); trims {sum(1 for p in pieces if p[0]=='play')-len(starts)} holds {sum(1 for p in pieces if p[0]=='hold')}")


if __name__ == "__main__":
    main()
