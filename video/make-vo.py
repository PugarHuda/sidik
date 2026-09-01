"""
Voiceover, one file per subtitle cue.

Synthesised line by line rather than as one track, for two reasons: the caption
timing is then MEASURED from each clip instead of guessed at, and a line that
reads badly can be redone without re-recording the whole thing.

Microsoft's neural voices through edge-tts. No API key, and no cost, which
matters for a project whose entire hosting story was "every free tier said no".

    python video/make-vo.py

Writes video/assets/vo/<id>.mp3 and video/assets/timing.json.
"""
import asyncio
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "assets" / "vo"


def duration_of(path: pathlib.Path) -> float:
    """Seconds, read out of the file rather than estimated from the text."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True)
    return round(float(probe.stdout.strip()), 3)


async def main() -> int:
    import edge_tts

    spec = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    timing, at = [], 0.0
    for line in spec["lines"]:
        path = OUT / f"{line['id']}.mp3"
        tts = edge_tts.Communicate(line["text"], spec["voice"], rate=spec.get("rate", "+0%"))
        await tts.save(str(path))
        if path.stat().st_size < 1000:
            print(f"  {line['id']}: refusing a {path.stat().st_size}-byte clip", file=sys.stderr)
            return 1
        secs = duration_of(path)
        timing.append({"id": line["id"], "scene": line["scene"], "text": line["text"],
                       "start": round(at, 3), "duration": secs})
        # A beat between cues so lines do not run into each other, and a longer
        # one at a scene change because the picture has to move too.
        at += secs + 0.28
        print(f"  {line['id']:8} {secs:5.2f}s  {line['text'][:58]}")

    (ROOT / "assets" / "timing.json").write_text(
        json.dumps({"voice": spec["voice"], "total": round(at, 3), "cues": timing}, indent=2),
        encoding="utf-8")
    words = sum(len(c["text"].split()) for c in timing)
    print(f"\n{len(timing)} cues, {round(at, 1)}s total, {words} words "
          f"({round(words / at * 60)} wpm)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
