import React from "react";
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile,
  interpolate, useCurrentFrame, useVideoConfig,
} from "remotion";
import timing from "../public/timing.json";

/**
 * The demo video.
 *
 * Two rules shape all of it. Nothing on screen is a mockup — every frame of
 * the browser is a Playwright recording of the deployed site, and the live-run
 * section is a real fork execution, not a replay. And no caption is placed by
 * hand: each one is positioned from the measured duration of its own
 * voiceover clip (see video/make-vo.py), so the subtitles cannot drift out of
 * sync with the narration however the script is edited.
 */

// Straight from web/app/globals.css.
const INK = "#0a0c0e";
const FG = "#e7eaee";
const DIM = "#9aa3b2";
const ACCENT = "#8aa4ff";
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace";
const SANS = "Inter, ui-sans-serif, system-ui, sans-serif";

export const FPS = 30;
export const TOTAL_FRAMES = Math.ceil((timing.total + 1.2) * FPS);

type Cue = { id: string; scene: string; text: string; start: number; duration: number };
const cues = timing.cues as Cue[];

/** One entry per scene, in order, with the frame range its cues occupy. */
function scenes() {
  const out: { scene: string; from: number; durationInFrames: number }[] = [];
  for (const cue of cues) {
    const last = out[out.length - 1];
    const end = Math.round((cue.start + cue.duration + 0.28) * FPS);
    if (last && last.scene === cue.scene) last.durationInFrames = end - last.from;
    else out.push({ scene: cue.scene, from: Math.round(cue.start * FPS), durationInFrames: end - Math.round(cue.start * FPS) });
  }
  return out;
}

/** Which recording backs each scene; the two card scenes have none. */
const CLIP: Record<string, string | null> = {
  title: null, landing: "landing", paste: "paste", live: "live",
  findings: "findings", verified: "verified", ownertrap: "ownertrap",
  scanners: "scanners", outro: null,
};

const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cue = cues.find((c) => t >= c.start && t < c.start + c.duration + 0.24);
  if (!cue) return null;
  // A short fade, because a caption that snaps on reads as a glitch at this size.
  const opacity = interpolate(t - cue.start, [0, 0.12, cue.duration, cue.duration + 0.24], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 64 }}>
      <div style={{
        opacity, maxWidth: 1500, margin: "0 72px", padding: "20px 34px", borderRadius: 14,
        background: "rgba(10,12,14,0.86)", border: "1px solid rgba(138,164,255,0.22)",
        color: FG, font: `500 40px/1.34 ${SANS}`, textAlign: "center",
        textShadow: "0 2px 18px rgba(0,0,0,0.8)",
      }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

/** The fingerprint from docs/brand, reused rather than redrawn. */
const Mark: React.FC<{ size: number }> = ({ size }) => (
  <Img src={staticFile("sidik-logo.png")} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
);

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 22], [26, 0], { extrapolateRight: "clamp" });
  const fade = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: INK, justifyContent: "center", alignItems: "center", gap: 40 }}>
      <div style={{ opacity: fade, transform: `translateY(${rise}px)`, display: "flex", alignItems: "center", gap: 36 }}>
        <Mark size={168} />
        <div>
          <div style={{ color: ACCENT, font: `600 30px/1 ${MONO}`, letterSpacing: 14 }}>SIDIK</div>
          <div style={{ color: FG, font: `600 78px/1.1 ${SANS}`, marginTop: 16 }}>Executed, not inferred</div>
          <div style={{ color: DIM, font: `400 34px/1.4 ${SANS}`, marginTop: 14 }}>
            Token safety on Base, proven by doing it
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Figure: React.FC<{ big: string; label: string }> = ({ big, label }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ color: FG, font: `600 76px/1 ${MONO}`, fontVariantNumeric: "tabular-nums" }}>{big}</div>
    <div style={{ color: ACCENT, font: `500 21px/1.3 ${MONO}`, letterSpacing: 3, marginTop: 14, textTransform: "uppercase" }}>{label}</div>
  </div>
);

const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: INK, justifyContent: "center", alignItems: "center", gap: 66, opacity: fade }}>
      <div style={{ display: "flex", gap: 110 }}>
        <Figure big="207" label="addresses executed" />
        <Figure big="1,843" label="fork transactions" />
        <Figure big="68" label="carry a finding" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        <Mark size={92} />
        <div style={{ color: FG, font: `600 52px/1.1 ${SANS}` }}>sidik-eight.vercel.app</div>
      </div>
      <div style={{ color: DIM, font: `400 27px/1.4 ${MONO}` }}>
        github.com/PugarHuda/sidik · every verdict reproducible from your own fork
      </div>
    </AbsoluteFill>
  );
};

/** A recording, with the site's own ink behind it so letterboxing is invisible. */
const Clip: React.FC<{ name: string }> = ({ name }) => (
  <AbsoluteFill style={{ background: INK }}>
    <OffthreadVideo src={staticFile(`clips/${name}.mp4`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
  </AbsoluteFill>
);

export const Demo: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: INK }}>
      {scenes().map((s) => (
        <Sequence key={`${s.scene}-${s.from}`} from={s.from} durationInFrames={Math.max(1, s.durationInFrames)}>
          {CLIP[s.scene] ? <Clip name={CLIP[s.scene]!} /> : s.scene === "title" ? <TitleCard /> : <OutroCard />}
        </Sequence>
      ))}

      {/* Each line as its own element at its own frame: one concatenated track
          would have to be rebuilt, and re-synced, every time a line changes. */}
      {cues.map((c) => (
        <Sequence key={c.id} from={Math.round(c.start * FPS)} durationInFrames={Math.ceil((c.duration + 0.3) * FPS)}>
          <Audio src={staticFile(`vo/${c.id}.mp3`)} />
        </Sequence>
      ))}

      <Caption />

      {/* A quiet, permanent mark. It is a demo of a real product, not a film. */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 40 }}>
        <div style={{ color: DIM, font: `500 22px/1 ${MONO}`, letterSpacing: 5, opacity: 0.75 }}>SIDIK</div>
      </AbsoluteFill>

      {/* Fade out on the last beat rather than cutting to black mid-word. */}
      <Sequence from={durationInFrames - 24}>
        <FadeOut />
      </Sequence>
    </AbsoluteFill>
  );
};

const FadeOut: React.FC = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ background: INK, opacity: interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp" }) }} />;
};
