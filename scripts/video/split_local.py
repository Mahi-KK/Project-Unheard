"""Split the one-take narration into per-line clips without any network:
dynamic programming over real pauses, matching each segment's length to the
line's expected length (proportional to its text). Writes voice/line_XX.wav + lines.json."""
import json, re, subprocess, sys, wave
from pathlib import Path
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe(); SR = 24000
build = Path(sys.argv[1]); vdir = build / "voice"; full = vdir / "full.wav"
lines = json.loads((Path(__file__).parent / "narration_v2.json").read_text(encoding="utf-8"))["lines"]
with wave.open(str(full), "rb") as w: pcm = w.readframes(w.getnframes())
total = len(pcm) / 2 / SR
r = subprocess.run([FF, "-hide_banner", "-i", str(full), "-af", "silencedetect=noise=-42dB:d=0.25", "-f", "null", "-"], capture_output=True, text=True)
S = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", r.stderr)]; E = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", r.stderr)]
cands = [((a + b) / 2, b - a) for a, b in zip(S, E) if a > 0.3 and b < total - 0.3]
weights = [len(re.sub(r"[^a-z]", "", l["text"].lower())) + 6 * len(re.findall(r"[.,:?]", l["text"])) for l in lines]
exp = [w / sum(weights) * total for w in weights]
K, N = len(lines), len(cands); pos = [0.0] + [c[0] for c in cands] + [total]; plen = [0.0] + [c[1] for c in cands] + [0.0]
INF = 1e18; best = [[INF] * (N + 2) for _ in range(K + 1)]; back = [[-1] * (N + 2) for _ in range(K + 1)]
best[0][0] = 0.0
for k in range(1, K + 1):
    js = [N + 1] if k == K else range(1, N + 1)
    for j in js:
        for i in range(0, j):
            if best[k - 1][i] >= INF: continue
            if k - 1 > 0 and i == 0: continue
            d = pos[j] - pos[i]; c = ((d - exp[k - 1]) / exp[k - 1]) ** 2 - (0.35 * plen[j] if j <= N else 0)
            if best[k - 1][i] + c < best[k][j]: best[k][j] = best[k - 1][i] + c; back[k][j] = i
b = [N + 1]
for k in range(K, 0, -1): b.append(back[k][b[-1]])
b = b[::-1]; bounds = [pos[j] for j in b]
report = []
for i, l in enumerate(lines):
    p = vdir / f"line_{i:02d}.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm[int(bounds[i] * SR) * 2:int(bounds[i + 1] * SR) * 2])
    t = p.with_name(p.stem + "_t.wav")
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", str(p), "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse", str(t)], check=True)
    t.replace(p)
    with wave.open(str(p), "rb") as w: dur = w.getnframes() / w.getframerate()
    report.append({"i": i, "cue": l["cue"], "at": l["at"], "seconds": round(dur, 2), "expected": round(exp[i], 1), "text": l["text"]})
    print(f"{i:02d} {l['cue']:<12} {bounds[i]:6.1f}-{bounds[i+1]:6.1f}  {dur:5.1f}s (exp {exp[i]:4.1f})  {l['text'][:55]}")
(vdir / "lines.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
