"""Generate the demo voiceover with ONE Gemini TTS voice, split it into one
clip per narration line, and verify every clip by transcription.

    backend/.venv/Scripts/python scripts/video/narrate.py <build>

Writes <build>/voice/line_XX.wav (24 kHz mono, natural speed, never time-stretched)
and <build>/voice/lines.json (duration + verified transcript per line).
"""
from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import imageio_ffmpeg
from dotenv import load_dotenv
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")
FF = imageio_ffmpeg.get_ffmpeg_exe()
MODEL = os.environ.get("NARRATION_TTS_MODEL", "gemini-3.1-flash-tts-preview")
VOICE = os.environ.get("NARRATION_VOICE", "Charon")
STYLE = ("You are the narrator of a product demo video for a hackathon jury. Speak naturally and warmly, like a confident "
         "presenter: brisk and energetic but clear, about 150 words per minute, natural intonation. Pronounce Indian place "
         "names correctly. The script has numbered lines: do NOT read the numbers. After each line, stay completely silent "
         "for two full seconds before the next line.\n\n")
JUDGES = ("gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.1-flash-lite")
SR = 24000


def tts(client, text: str) -> bytes:
    for attempt in range(5):
        try:
            r = client.models.generate_content(
                model=MODEL,
                contents=STYLE + text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE))),
                ),
            )
            return r.candidates[0].content.parts[0].inline_data.data
        except Exception as e:  # noqa: BLE001
            print(f"  tts attempt {attempt + 1} failed: {str(e)[:120]}")
            time.sleep(10 * (attempt + 1))
    raise SystemExit("TTS failed")


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)


def pauses(path: Path) -> list[tuple[float, float]]:
    r = subprocess.run([FF, "-hide_banner", "-i", str(path), "-af", "silencedetect=noise=-42dB:d=0.25", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", r.stderr)]
    return list(zip(starts, ends))


def ask(client, parts, want_json: bool):
    for jm in JUDGES * 3:
        try:
            r = client.models.generate_content(
                model=jm,
                contents=parts,
                config=types.GenerateContentConfig(response_mime_type="application/json" if want_json else "text/plain", temperature=0),
            )
            return r.text, jm
        except Exception as e:  # noqa: BLE001
            print(f"  {jm} failed: {str(e)[:70]}")
            time.sleep(5)
    raise SystemExit("Gemini unavailable")


def align(client, full: Path, total: float, lines: list[dict]) -> list[float]:
    """Line boundaries = Gemini's estimate of where each numbered line starts,
    snapped to the nearest real pause in the audio."""
    script = "\n".join(f"{i + 1}. {l['text']}" for i, l in enumerate(lines))
    prompt = ("This audio is a narrator reading the numbered script below (the numbers are not spoken). For EVERY line, "
              "give the time in seconds (with decimals) at which that line's first word begins. Listen carefully to the words. "
              'Reply as JSON {"starts": [...]} with exactly ' + str(len(lines)) + " increasing numbers.\n\n" + script)
    for _ in range(3):
        text, jm = ask(client, [prompt, types.Part.from_bytes(data=full.read_bytes(), mime_type="audio/wav")], True)
        cand = json.loads(text).get("starts", [])
        if len(cand) == len(lines) and all(b > a for a, b in zip(cand, cand[1:])):
            print("  aligned by", jm)
            starts = [float(x) for x in cand]
            break
    else:
        raise SystemExit("could not align narration")
    mids = [((a + b) / 2, b - a) for a, b in pauses(full)]
    bounds = [0.0]
    for est in starts[1:]:
        near = [(abs(m - est) - 0.4 * d, m) for m, d in mids if abs(m - est) < 2.0 and m > bounds[-1] + 1.0]
        bounds.append(min(near)[1] if near else est)
    bounds.append(total)
    return bounds


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " "))


def main() -> None:
    build = Path(sys.argv[1])
    vdir = build / "voice"
    vdir.mkdir(parents=True, exist_ok=True)
    lines = json.loads((Path(__file__).parent / "narration_v2.json").read_text(encoding="utf-8"))["lines"]
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    full = vdir / "full.wav"
    if not full.exists():
        script = "\n\n".join(f"{i + 1}. {l['text']}" for i, l in enumerate(lines))
        write_wav(full, tts(client, script))
    with wave.open(str(full), "rb") as w:
        pcm = w.readframes(w.getnframes())
    total = len(pcm) / 2 / SR
    bounds = align(client, full, total, lines)

    report = []
    for i, line in enumerate(lines):
        a, b = bounds[i], bounds[i + 1]
        path = vdir / f"line_{i:02d}.wav"
        write_wav(path, pcm[int(a * SR) * 2: int(b * SR) * 2])
        trimmed = path.with_name(path.stem + "_t.wav")
        subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-af",
                        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,"
                        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse",
                        str(trimmed)], check=True)
        trimmed.replace(path)
        with wave.open(str(path), "rb") as w:
            dur = w.getnframes() / w.getframerate()
        heard, _ = ask(client, ["Transcribe this narration exactly, as plain text only.", types.Part.from_bytes(data=path.read_bytes(), mime_type="audio/wav")], False)
        heard = heard.strip()
        ratio = difflib.SequenceMatcher(None, norm(heard), norm(line["text"])).ratio()
        report.append({"i": i, "cue": line["cue"], "at": line["at"], "seconds": round(dur, 2), "match": round(ratio, 3), "heard": heard, "text": line["text"]})
        print(f"{i:02d} {line['cue']:<12} {dur:5.1f}s match {ratio:.2f}  {heard[:80]}")
    (vdir / "lines.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    bad = [r["i"] for r in report if r["match"] < 0.85]
    print(f"total speech {sum(r['seconds'] for r in report):.0f}s; lines below 0.85 match: {bad}")


if __name__ == "__main__":
    main()
