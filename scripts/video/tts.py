"""Generate the demo narration with Gemini text-to-speech.

    backend/.venv/Scripts/python scripts/video/tts.py <build_dir>

Writes <build_dir>/audio/<segment>.wav (24 kHz mono) and durations.json.
Needs GEMINI_API_KEY (read from backend/.env or the environment).
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
from google.genai import errors, types

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")
MODELS = [m for m in os.environ.get("GEMINI_TTS_MODELS", "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-3.1-flash-tts-preview").split(",") if m]


def main() -> None:
    build = Path(sys.argv[1])
    (build / "audio").mkdir(parents=True, exist_ok=True)
    spec = json.loads((Path(__file__).parent / "narration.json").read_text(encoding="utf-8"))
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    durations: dict[str, float] = {}
    models = list(MODELS)
    for seg in spec["segments"]:
        out = build / "audio" / f"{seg['id']}.wav"
        if not out.exists():
            prompt = ("Read this as a calm, confident documentary narrator for a civic technology product demo, "
                      "clear Indian English, measured pace:\n\n" + seg["text"])
            for attempt in range(6):
                try:
                    r = client.models.generate_content(
                        model=models[0],
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_modalities=["AUDIO"],
                            speech_config=types.SpeechConfig(
                                voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=spec["voice"]))
                            ),
                        ),
                    )
                    pcm = r.candidates[0].content.parts[0].inline_data.data
                    break
                except (errors.APIError, AttributeError) as e:
                    if "PerDay" in str(e) and len(models) > 1:
                        print(f"  {models[0]} daily quota used up; switching to {models[1]}")
                        models.pop(0)
                        continue
                    wait = 8 * (attempt + 1)
                    print(f"  {seg['id']}: {getattr(e, 'code', e)}, retrying in {wait}s")
                    time.sleep(wait)
            else:
                raise SystemExit(f"TTS failed for {seg['id']}")
            with wave.open(str(out), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(pcm)
            time.sleep(4)
        with wave.open(str(out), "rb") as w:
            durations[seg["id"]] = w.getnframes() / w.getframerate()
        print(f"{seg['id']}: {durations[seg['id']]:.1f}s")
    (build / "durations.json").write_text(json.dumps(durations, indent=1), encoding="utf-8")
    print(f"total narration {sum(durations.values()):.0f}s")


if __name__ == "__main__":
    main()
