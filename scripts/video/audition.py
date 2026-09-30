"""Audition Gemini TTS voices and have Gemini rate them (naturalness, pace,
pronunciation of Indian place names). Writes <build>/audition/*.wav + scores.

    backend/.venv/Scripts/python scripts/video/audition.py <build> model:voice [model:voice ...]
"""
from __future__ import annotations

import json
import os
import sys
import time
import wave
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")

SAMPLE = ("Now a new request arrives, in Kannada, from a village in Raichur, about drinking water. "
          "Raichur now has a voice. Bijapur, Pashchimi Singhbhum and Dindori don't, yet.")
STYLE = ("You are the narrator of a product demo video. Speak naturally and warmly, like a confident presenter "
         "talking to a jury: brisk and energetic but clear, about 150 words per minute, natural intonation, no long pauses. Pronounce Indian place names correctly. Read:\n\n")


def tts(client, model: str, voice: str, text: str) -> bytes:
    r = client.models.generate_content(
        model=model,
        contents=STYLE + text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
        ),
    )
    return r.candidates[0].content.parts[0].inline_data.data


def save(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)


def main() -> None:
    build = Path(sys.argv[1])
    out = build / "audition"
    out.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    results = []
    for spec in sys.argv[2:]:
        model, voice = spec.split(":")
        path = out / f"{model}__{voice}.wav"
        if not path.exists():
            try:
                save(path, tts(client, model, voice, SAMPLE))
            except Exception as e:  # noqa: BLE001
                print(spec, "TTS failed:", str(e)[:160])
                continue
            time.sleep(3)
        judge = None
        for jm in ("gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.1-flash-lite") * 2:
            try:
                judge = client.models.generate_content(
            model=jm,
            contents=[
                "You are an audio director choosing a narrator for a hackathon demo video. Listen carefully. "
                "Rate 1-10: naturalness (human-like, not robotic), warmth, pacing (not too slow/fast, no odd pauses), "
                "pronunciation of 'Raichur', 'Pashchimi Singhbhum', 'Dindori', 'Kannada', and audio quality (no artifacts). "
                "Also transcribe exactly what is said. Reply as JSON with keys naturalness, warmth, pacing, pronunciation, quality, overall, transcript, notes. "
                f"Expected text: {SAMPLE}",
                types.Part.from_bytes(data=path.read_bytes(), mime_type="audio/wav"),
            ],
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0),
                )
                break
            except Exception as e:  # noqa: BLE001
                print("  judge", jm, "failed:", str(e)[:80])
                time.sleep(4)
        score = json.loads(judge.text)
        with wave.open(str(path), "rb") as w:
            dur = w.getnframes() / w.getframerate()
        score.update(spec=spec, seconds=round(dur, 1), words_per_s=round(len(SAMPLE.split()) / dur, 2))
        results.append(score)
        print(json.dumps({k: score[k] for k in ("spec", "overall", "naturalness", "pacing", "pronunciation", "quality", "seconds", "words_per_s", "notes")}, ensure_ascii=False))
        time.sleep(2)
    (out / "scores.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
