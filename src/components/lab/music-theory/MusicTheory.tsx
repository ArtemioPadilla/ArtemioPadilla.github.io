import { useState, useRef, useEffect, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type WaveformType = "sine" | "triangle" | "sawtooth" | "square";
type ViewTab = "keyboard" | "circle" | "staff";
type ChordPlayMode = "block" | "arpeggio";

interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

interface ScaleDefinition {
  name: string;
  intervals: number[];
}

interface ChordDefinition {
  name: string;
  symbol: string;
  intervals: number[];
}

interface ProgressionDefinition {
  name: string;
  degrees: number[];
  qualities: string[];
}

/* ══════════════════════════════════════════════════════════
   Constants — Music Theory Data
   ══════════════════════════════════════════════════════════ */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const ENHARMONIC_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

const SCALES: ScaleDefinition[] = [
  { name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Natural Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
  { name: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
  { name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

const CHORDS: ChordDefinition[] = [
  { name: "Major", symbol: "", intervals: [0, 4, 7] },
  { name: "Minor", symbol: "m", intervals: [0, 3, 7] },
  { name: "Diminished", symbol: "dim", intervals: [0, 3, 6] },
  { name: "Augmented", symbol: "aug", intervals: [0, 4, 8] },
  { name: "Dominant 7th", symbol: "7", intervals: [0, 4, 7, 10] },
  { name: "Major 7th", symbol: "maj7", intervals: [0, 4, 7, 11] },
  { name: "Minor 7th", symbol: "m7", intervals: [0, 3, 7, 10] },
  { name: "Sus2", symbol: "sus2", intervals: [0, 2, 7] },
  { name: "Sus4", symbol: "sus4", intervals: [0, 5, 7] },
];

const PROGRESSIONS: ProgressionDefinition[] = [
  { name: "I - IV - V - I", degrees: [0, 5, 7, 0], qualities: ["Major", "Major", "Major", "Major"] },
  { name: "I - V - vi - IV", degrees: [0, 7, 9, 5], qualities: ["Major", "Major", "Minor", "Major"] },
  { name: "ii - V - I", degrees: [2, 7, 0], qualities: ["Minor", "Major", "Major"] },
  { name: "I - vi - IV - V", degrees: [0, 9, 5, 7], qualities: ["Major", "Minor", "Major", "Major"] },
  { name: "12-Bar Blues", degrees: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7], qualities: ["Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th", "Dominant 7th"] },
];

const CIRCLE_OF_FIFTHS_MAJOR = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C, G, D, A, E, B, F#, Db, Ab, Eb, Bb, F
const CIRCLE_OF_FIFTHS_MINOR = [9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2]; // Am, Em, Bm, F#m, C#m, G#m, Ebm, Bbm, Fm, Cm, Gm, Dm

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR_SCALE_QUALITIES = ["Major", "Minor", "Minor", "Major", "Major", "Minor", "Diminished"];

// Piano keyboard layout for 2 octaves (C4 to B5)
const OCTAVE_START = 4;
const NUM_OCTAVES = 2;
const WHITE_KEYS_PER_OCTAVE = 7;
const TOTAL_WHITE_KEYS = WHITE_KEYS_PER_OCTAVE * NUM_OCTAVES;

// Which indices in the 12-note chromatic scale are white keys
const WHITE_KEY_INDICES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEY_INDICES = [1, 3, 6, 8, 10];

// Black key positions relative to white keys (fractional)
const BLACK_KEY_OFFSETS: Record<number, number> = {
  1: 0.65, // C#: between C and D
  3: 1.75, // D#: between D and E
  6: 3.6, // F#: between F and G
  8: 4.65, // G#: between G and A
  10: 5.75, // A#: between A and B
};

/* ══════════════════════════════════════════════════════════
   Music Theory Utilities
   ══════════════════════════════════════════════════════════ */

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteToMidi(noteIndex: number, octave: number): number {
  return (octave + 1) * 12 + noteIndex;
}

function getScaleNotes(rootIndex: number, scale: ScaleDefinition): number[] {
  return scale.intervals.map((interval) => (rootIndex + interval) % 12);
}

function getChordNotes(rootIndex: number, chord: ChordDefinition): number[] {
  return chord.intervals.map((interval) => (rootIndex + interval) % 12);
}

function getIntervalName(semitones: number): string {
  const names: Record<number, string> = {
    0: "Unison (P1)",
    1: "Minor 2nd (m2)",
    2: "Major 2nd (M2)",
    3: "Minor 3rd (m3)",
    4: "Major 3rd (M3)",
    5: "Perfect 4th (P4)",
    6: "Tritone (A4/d5)",
    7: "Perfect 5th (P5)",
    8: "Minor 6th (m6)",
    9: "Major 6th (M6)",
    10: "Minor 7th (m7)",
    11: "Major 7th (M7)",
    12: "Octave (P8)",
  };
  const normalized = ((semitones % 12) + 12) % 12;
  return names[normalized] ?? `${normalized} semitones`;
}

function getDegreeRoman(degreeIndex: number, quality: string): string {
  const roman = ROMAN_NUMERALS[degreeIndex % 7];
  if (quality === "Minor" || quality === "Diminished") {
    return roman.toLowerCase() + (quality === "Diminished" ? "°" : "");
  }
  return roman;
}

function getNoteName(noteIndex: number, useFlats: boolean = false): string {
  return useFlats ? ENHARMONIC_NAMES[noteIndex] : NOTE_NAMES[noteIndex];
}

/* ══════════════════════════════════════════════════════════
   Audio Engine
   ══════════════════════════════════════════════════════════ */

interface AudioEngine {
  context: AudioContext;
  masterGain: GainNode;
}

function createAudioEngine(): AudioEngine {
  const context = new AudioContext();
  const masterGain = context.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(context.destination);
  return { context, masterGain };
}

function playNote(
  engine: AudioEngine,
  frequency: number,
  waveform: WaveformType,
  adsr: Adsr,
  duration: number = 0.5,
): void {
  const { context, masterGain } = engine;
  const osc = context.createOscillator();
  const envGain = context.createGain();

  osc.type = waveform;
  osc.frequency.value = frequency;
  osc.connect(envGain);
  envGain.connect(masterGain);

  const now = context.currentTime;
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(1, now + adsr.attack);
  envGain.gain.linearRampToValueAtTime(adsr.sustain, now + adsr.attack + adsr.decay);
  envGain.gain.setValueAtTime(adsr.sustain, now + duration - adsr.release);
  envGain.gain.linearRampToValueAtTime(0, now + duration);

  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function playChordNotes(
  engine: AudioEngine,
  midiNotes: number[],
  waveform: WaveformType,
  adsr: Adsr,
  mode: ChordPlayMode,
): void {
  if (mode === "block") {
    for (const midi of midiNotes) {
      playNote(engine, midiToFrequency(midi), waveform, adsr, 1.0);
    }
  } else {
    midiNotes.forEach((midi, i) => {
      const delay = i * 0.15;
      setTimeout(() => {
        playNote(engine, midiToFrequency(midi), waveform, adsr, 0.6);
      }, delay * 1000);
    });
  }
}

/* ══════════════════════════════════════════════════════════
   Piano Keyboard Drawing
   ══════════════════════════════════════════════════════════ */

interface KeyboardLayout {
  whiteKeyWidth: number;
  whiteKeyHeight: number;
  blackKeyWidth: number;
  blackKeyHeight: number;
  totalWidth: number;
}

function computeKeyboardLayout(canvasWidth: number): KeyboardLayout {
  const whiteKeyWidth = canvasWidth / TOTAL_WHITE_KEYS;
  const whiteKeyHeight = 140;
  const blackKeyWidth = whiteKeyWidth * 0.6;
  const blackKeyHeight = whiteKeyHeight * 0.6;
  return { whiteKeyWidth, whiteKeyHeight, blackKeyWidth, blackKeyHeight, totalWidth: canvasWidth };
}

function drawPianoKeyboard(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardLayout,
  highlightedNotes: Set<number>,
  activeNote: number | null,
  isDark: boolean,
): void {
  const { whiteKeyWidth, whiteKeyHeight, blackKeyWidth, blackKeyHeight } = layout;

  ctx.clearRect(0, 0, layout.totalWidth, whiteKeyHeight + 24);

  // Draw white keys
  let whiteIndex = 0;
  for (let oct = 0; oct < NUM_OCTAVES; oct++) {
    for (const noteInOctave of WHITE_KEY_INDICES) {
      const noteIndex = noteInOctave;
      const midi = noteToMidi(noteIndex, OCTAVE_START + oct);
      const x = whiteIndex * whiteKeyWidth;
      const isHighlighted = highlightedNotes.has(noteIndex);
      const isActive = activeNote === midi;

      // Key fill
      if (isActive) {
        ctx.fillStyle = "#4f8ff7";
      } else if (isHighlighted) {
        ctx.fillStyle = isDark ? "rgba(52, 211, 153, 0.3)" : "rgba(52, 211, 153, 0.4)";
      } else {
        ctx.fillStyle = isDark ? "#1a1a2e" : "#ffffff";
      }
      ctx.fillRect(x + 1, 0, whiteKeyWidth - 2, whiteKeyHeight);

      // Key border
      ctx.strokeStyle = isDark ? "#333" : "#999";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, 0, whiteKeyWidth - 2, whiteKeyHeight);

      // Note label
      ctx.fillStyle = isDark ? "#888" : "#666";
      ctx.font = "10px Inter, sans-serif";
      ctx.textAlign = "center";
      const label = NOTE_NAMES[noteIndex] + (OCTAVE_START + oct);
      ctx.fillText(label, x + whiteKeyWidth / 2, whiteKeyHeight - 6);

      whiteIndex++;
    }
  }

  // Draw black keys
  for (let oct = 0; oct < NUM_OCTAVES; oct++) {
    const octaveOffsetWhite = oct * WHITE_KEYS_PER_OCTAVE;
    for (const noteInOctave of BLACK_KEY_INDICES) {
      const noteIndex = noteInOctave;
      const midi = noteToMidi(noteIndex, OCTAVE_START + oct);
      const offset = BLACK_KEY_OFFSETS[noteInOctave];
      const x = (octaveOffsetWhite + offset) * whiteKeyWidth - blackKeyWidth / 2 + whiteKeyWidth / 2;
      const isHighlighted = highlightedNotes.has(noteIndex);
      const isActive = activeNote === midi;

      if (isActive) {
        ctx.fillStyle = "#4f8ff7";
      } else if (isHighlighted) {
        ctx.fillStyle = isDark ? "rgba(52, 211, 153, 0.6)" : "rgba(34, 197, 94, 0.7)";
      } else {
        ctx.fillStyle = isDark ? "#111" : "#222";
      }

      // Rounded black key shape
      const radius = 3;
      ctx.beginPath();
      ctx.moveTo(x + radius, 0);
      ctx.lineTo(x + blackKeyWidth - radius, 0);
      ctx.quadraticCurveTo(x + blackKeyWidth, 0, x + blackKeyWidth, radius);
      ctx.lineTo(x + blackKeyWidth, blackKeyHeight - radius);
      ctx.quadraticCurveTo(x + blackKeyWidth, blackKeyHeight, x + blackKeyWidth - radius, blackKeyHeight);
      ctx.lineTo(x + radius, blackKeyHeight);
      ctx.quadraticCurveTo(x, blackKeyHeight, x, blackKeyHeight - radius);
      ctx.lineTo(x, radius);
      ctx.quadraticCurveTo(x, 0, x + radius, 0);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isDark ? "#000" : "#111";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function getClickedMidi(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  layout: KeyboardLayout,
): number | null {
  const x = clientX - canvasRect.left;
  const y = clientY - canvasRect.top;
  const { whiteKeyWidth, whiteKeyHeight, blackKeyWidth, blackKeyHeight } = layout;

  // Check black keys first (they are on top)
  for (let oct = 0; oct < NUM_OCTAVES; oct++) {
    const octaveOffsetWhite = oct * WHITE_KEYS_PER_OCTAVE;
    for (const noteInOctave of BLACK_KEY_INDICES) {
      const offset = BLACK_KEY_OFFSETS[noteInOctave];
      const bx = (octaveOffsetWhite + offset) * whiteKeyWidth - blackKeyWidth / 2 + whiteKeyWidth / 2;
      if (x >= bx && x <= bx + blackKeyWidth && y >= 0 && y <= blackKeyHeight) {
        return noteToMidi(noteInOctave, OCTAVE_START + oct);
      }
    }
  }

  // Check white keys
  if (y >= 0 && y <= whiteKeyHeight) {
    const whiteIdx = Math.floor(x / whiteKeyWidth);
    if (whiteIdx >= 0 && whiteIdx < TOTAL_WHITE_KEYS) {
      const oct = Math.floor(whiteIdx / WHITE_KEYS_PER_OCTAVE);
      const keyInOctave = whiteIdx % WHITE_KEYS_PER_OCTAVE;
      const noteInOctave = WHITE_KEY_INDICES[keyInOctave];
      return noteToMidi(noteInOctave, OCTAVE_START + oct);
    }
  }

  return null;
}

/* ══════════════════════════════════════════════════════════
   Staff Notation Drawing
   ══════════════════════════════════════════════════════════ */

// Staff line positions: E4=0, G4=1, B4=2, D5=3, F5=4 (bottom to top)
// Middle C (C4) is one ledger line below

function staffYForMidi(midi: number, baseY: number, lineSpacing: number): number {
  // Map MIDI to staff position. 60=C4, 62=D4, 64=E4 (bottom line)
  // Each staff position is a half-step in note space
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;

  // Map note to staff offset (C=0, D=1, E=2, F=3, G=4, A=5, B=6)
  const diatonicMap: Record<number, number> = {
    0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6,
  };
  const diatonic = diatonicMap[noteIndex];
  const totalDiatonic = (octave - 4) * 7 + diatonic; // relative to C4
  // E4 (diatonic=2 from C4) sits on bottom line (staff position 0)
  const staffPos = totalDiatonic - 2;
  return baseY - staffPos * (lineSpacing / 2);
}

function isSharp(noteIndex: number): boolean {
  return BLACK_KEY_INDICES.includes(noteIndex);
}

function drawStaffNotation(
  ctx: CanvasRenderingContext2D,
  width: number,
  notes: number[],
  isDark: boolean,
): void {
  const height = 140;
  const lineSpacing = 14;
  const baseY = 95; // bottom staff line
  const leftMargin = 45;
  const staffColor = isDark ? "#555" : "#aaa";
  const noteColor = isDark ? "#e4e4e7" : "#333";
  const accentColor = "#34d399";

  ctx.clearRect(0, 0, width, height);

  // Draw 5 staff lines
  ctx.strokeStyle = staffColor;
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = baseY - i * lineSpacing;
    ctx.beginPath();
    ctx.moveTo(leftMargin - 10, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();
  }

  // Draw treble clef symbol
  ctx.fillStyle = isDark ? "#aaa" : "#555";
  ctx.font = "bold 40px serif";
  ctx.textAlign = "left";
  ctx.fillText("\u{1D11E}", 8, baseY + 6);

  if (notes.length === 0) return;

  // Draw note heads
  const noteSpacing = Math.min(40, (width - leftMargin - 30) / Math.max(notes.length, 1));
  notes.forEach((midi, i) => {
    const x = leftMargin + 20 + i * noteSpacing;
    const y = staffYForMidi(midi, baseY, lineSpacing);
    const noteIdx = midi % 12;

    // Ledger lines
    if (y > baseY) {
      for (let ly = baseY + lineSpacing; ly <= y; ly += lineSpacing) {
        ctx.strokeStyle = staffColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 10, ly);
        ctx.lineTo(x + 10, ly);
        ctx.stroke();
      }
    }
    const topLine = baseY - 4 * lineSpacing;
    if (y < topLine) {
      for (let ly = topLine - lineSpacing; ly >= y; ly -= lineSpacing) {
        ctx.strokeStyle = staffColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 10, ly);
        ctx.lineTo(x + 10, ly);
        ctx.stroke();
      }
    }

    // Note head (filled ellipse)
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 4.5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Stem
    ctx.strokeStyle = noteColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (y > baseY - 2 * lineSpacing) {
      // Stem up
      ctx.moveTo(x + 5.5, y);
      ctx.lineTo(x + 5.5, y - 30);
    } else {
      // Stem down
      ctx.moveTo(x - 5.5, y);
      ctx.lineTo(x - 5.5, y + 30);
    }
    ctx.stroke();

    // Sharp sign
    if (isSharp(noteIdx)) {
      ctx.fillStyle = isDark ? "#ccc" : "#555";
      ctx.font = "bold 14px serif";
      ctx.textAlign = "right";
      ctx.fillText("#", x - 9, y + 5);
    }

    // Note name below
    ctx.fillStyle = isDark ? "#888" : "#777";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(NOTE_NAMES[noteIdx], x, baseY + 28);
  });
}

/* ══════════════════════════════════════════════════════════
   Circle of Fifths Component
   ══════════════════════════════════════════════════════════ */

function CircleOfFifths({
  rootNote,
  scaleNotes,
  onSelectRoot,
  isDark,
}: {
  rootNote: number;
  scaleNotes: Set<number>;
  onSelectRoot: (note: number) => void;
  isDark: boolean;
}) {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 135;
  const innerR = 95;
  const minorR = 65;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      class="mx-auto"
      style={{ maxWidth: "100%" }}
    >
      {/* Background circle */}
      <circle cx={cx} cy={cy} r={outerR + 10} fill="none" stroke={isDark ? "#333" : "#ccc"} stroke-width="1" />
      <circle cx={cx} cy={cy} r={innerR} fill="none" stroke={isDark ? "#333" : "#ccc"} stroke-width="1" />
      <circle cx={cx} cy={cy} r={minorR - 10} fill="none" stroke={isDark ? "#333" : "#ccc"} stroke-width="1" />

      {/* Major keys (outer ring) */}
      {CIRCLE_OF_FIFTHS_MAJOR.map((noteIdx, i) => {
        const angle = (i * 30 - 90) * (Math.PI / 180);
        const x = cx + outerR * Math.cos(angle);
        const y = cy + outerR * Math.sin(angle);
        const isRoot = noteIdx === rootNote;
        const isInScale = scaleNotes.has(noteIdx);
        const label = getNoteName(noteIdx, i > 6);

        return (
          <g
            key={`major-${i}`}
            onClick={() => onSelectRoot(noteIdx)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={x}
              cy={y}
              r={18}
              fill={isRoot ? "#4f8ff7" : isInScale ? (isDark ? "rgba(52,211,153,0.3)" : "rgba(52,211,153,0.4)") : (isDark ? "#1a1a2e" : "#f5f5f5")}
              stroke={isRoot ? "#4f8ff7" : isDark ? "#555" : "#bbb"}
              stroke-width={isRoot ? 2 : 1}
            />
            <text
              x={x}
              y={y + 1}
              text-anchor="middle"
              dominant-baseline="middle"
              fill={isRoot ? "#fff" : isDark ? "#e4e4e7" : "#333"}
              font-size="12"
              font-weight={isRoot ? "bold" : "normal"}
              font-family="Inter, sans-serif"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Minor keys (inner ring) */}
      {CIRCLE_OF_FIFTHS_MINOR.map((noteIdx, i) => {
        const angle = (i * 30 - 90) * (Math.PI / 180);
        const x = cx + innerR * Math.cos(angle) * 0.65;
        const y = cy + innerR * Math.sin(angle) * 0.65;
        const isInScale = scaleNotes.has(noteIdx);
        const label = getNoteName(noteIdx, i > 6).toLowerCase() + "m";

        return (
          <g
            key={`minor-${i}`}
            onClick={() => onSelectRoot(noteIdx)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={x}
              cy={y}
              r={15}
              fill={isInScale ? (isDark ? "rgba(52,211,153,0.2)" : "rgba(52,211,153,0.3)") : (isDark ? "#111" : "#eee")}
              stroke={isDark ? "#444" : "#ccc"}
              stroke-width="1"
            />
            <text
              x={x}
              y={y + 1}
              text-anchor="middle"
              dominant-baseline="middle"
              fill={isDark ? "#aaa" : "#666"}
              font-size="9"
              font-family="Inter, sans-serif"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Center label */}
      <text
        x={cx}
        y={cy - 6}
        text-anchor="middle"
        dominant-baseline="middle"
        fill={isDark ? "#e4e4e7" : "#333"}
        font-size="14"
        font-weight="bold"
        font-family="Inter, sans-serif"
      >
        {getNoteName(rootNote)}
      </text>
      <text
        x={cx}
        y={cy + 10}
        text-anchor="middle"
        dominant-baseline="middle"
        fill={isDark ? "#888" : "#999"}
        font-size="9"
        font-family="Inter, sans-serif"
      >
        Circle of 5ths
      </text>
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════
   Chord Diagram Component
   ══════════════════════════════════════════════════════════ */

function ChordDiagram({
  rootNote,
  chord,
  isDark,
}: {
  rootNote: number;
  chord: ChordDefinition;
  isDark: boolean;
}) {
  const notes = getChordNotes(rootNote, chord);
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span
        style={{ color: isDark ? "var(--color-heading)" : "var(--color-heading)", fontWeight: 600, fontSize: "14px" }}
      >
        {getNoteName(rootNote)}{chord.symbol}:
      </span>
      {notes.map((n, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            backgroundColor: i === 0
              ? "#4f8ff7"
              : isDark
                ? "rgba(52,211,153,0.3)"
                : "rgba(52,211,153,0.4)",
            color: i === 0 ? "#fff" : isDark ? "#e4e4e7" : "#333",
            fontSize: "11px",
            fontWeight: 600,
          }}
        >
          {getNoteName(n)}
        </span>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function MusicTheory() {
  // State
  const [rootNote, setRootNote] = useState(0); // C
  const [scaleIndex, setScaleIndex] = useState(0); // Major
  const [chordIndex, setChordIndex] = useState(0); // Major
  const [waveform, setWaveform] = useState<WaveformType>("triangle");
  const [chordPlayMode, setChordPlayMode] = useState<ChordPlayMode>("block");
  const [activeTab, setActiveTab] = useState<ViewTab>("keyboard");
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const [intervalStart, setIntervalStart] = useState<number | null>(null);
  const [intervalEnd, setIntervalEnd] = useState<number | null>(null);
  const [intervalMode, setIntervalMode] = useState(false);
  const [progressionIndex, setProgressionIndex] = useState(0);
  const [progressionPlaying, setProgressionPlaying] = useState(false);
  const [progressionStep, setProgressionStep] = useState(-1);
  const [isDark, setIsDark] = useState(true);

  const [adsr] = useState<Adsr>({ attack: 0.02, decay: 0.1, sustain: 0.4, release: 0.15 });

  // Refs
  const pianoCanvasRef = useRef<HTMLCanvasElement>(null);
  const staffCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const progressionTimerRef = useRef<number | null>(null);
  const layoutRef = useRef<KeyboardLayout | null>(null);

  // Derived
  const currentScale = SCALES[scaleIndex];
  const currentChord = CHORDS[chordIndex];
  const scaleNotes = new Set(getScaleNotes(rootNote, currentScale));
  const chordNotes = new Set(getChordNotes(rootNote, currentChord));

  // Combine for display: scale notes + chord notes highlighted
  const highlightedNotes = new Set([...scaleNotes]);

  // Detect dark mode
  useEffect(() => {
    const checkDark = () => {
      setIsDark(!document.documentElement.classList.contains("light"));
    };
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Initialize audio engine lazily
  const getAudioEngine = useCallback((): AudioEngine => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = createAudioEngine();
    }
    if (audioEngineRef.current.context.state === "suspended") {
      audioEngineRef.current.context.resume();
    }
    return audioEngineRef.current;
  }, []);

  // Draw piano keyboard
  const drawKeyboard = useCallback(() => {
    const canvas = pianoCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 164 * dpr;
    ctx.scale(dpr, dpr);

    const layout = computeKeyboardLayout(rect.width);
    layoutRef.current = layout;
    drawPianoKeyboard(ctx, layout, highlightedNotes, activeNote, isDark);
  }, [highlightedNotes, activeNote, isDark]);

  // Draw staff
  const drawStaff = useCallback(() => {
    const canvas = staffCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 140 * dpr;
    ctx.scale(dpr, dpr);

    // Build MIDI notes for current chord in correct octave
    const chordMidi = currentChord.intervals.map((interval) => {
      const note = (rootNote + interval) % 12;
      const octave = rootNote + interval >= 12 ? OCTAVE_START + 1 : OCTAVE_START;
      return noteToMidi(note, octave);
    });

    drawStaffNotation(ctx, rect.width, chordMidi, isDark);
  }, [rootNote, currentChord, isDark]);

  // Redraw on state changes
  useEffect(() => {
    drawKeyboard();
    drawStaff();
  }, [drawKeyboard, drawStaff]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      drawKeyboard();
      drawStaff();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawKeyboard, drawStaff]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (progressionTimerRef.current !== null) {
        clearInterval(progressionTimerRef.current);
      }
      if (audioEngineRef.current) {
        audioEngineRef.current.context.close();
      }
    };
  }, []);

  // Handle piano click
  const handlePianoClick = useCallback(
    (e: MouseEvent) => {
      const canvas = pianoCanvasRef.current;
      if (!canvas || !layoutRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const midi = getClickedMidi(e.clientX, e.clientY, rect, layoutRef.current);
      if (midi === null) return;

      const engine = getAudioEngine();
      playNote(engine, midiToFrequency(midi), waveform, adsr);
      setActiveNote(midi);
      setTimeout(() => setActiveNote(null), 300);

      if (intervalMode) {
        if (intervalStart === null) {
          setIntervalStart(midi);
          setIntervalEnd(null);
        } else {
          setIntervalEnd(midi);
          setIntervalStart(null);
        }
      }
    },
    [waveform, adsr, getAudioEngine, intervalMode, intervalStart],
  );

  // Play chord
  const handlePlayChord = useCallback(() => {
    const engine = getAudioEngine();
    const midiNotes = currentChord.intervals.map((interval) => {
      return noteToMidi((rootNote + interval) % 12, OCTAVE_START);
    });
    playChordNotes(engine, midiNotes, waveform, adsr, chordPlayMode);
  }, [rootNote, currentChord, waveform, adsr, chordPlayMode, getAudioEngine]);

  // Play scale
  const handlePlayScale = useCallback(() => {
    const engine = getAudioEngine();
    currentScale.intervals.forEach((interval, i) => {
      setTimeout(() => {
        const note = (rootNote + interval) % 12;
        const oct = rootNote + interval >= 12 ? OCTAVE_START + 1 : OCTAVE_START;
        const midi = noteToMidi(note, oct);
        playNote(engine, midiToFrequency(midi), waveform, adsr, 0.4);
        setActiveNote(midi);
        setTimeout(() => setActiveNote(null), 250);
      }, i * 300);
    });
  }, [rootNote, currentScale, waveform, adsr, getAudioEngine]);

  // Play progression
  const handlePlayProgression = useCallback(() => {
    if (progressionPlaying) {
      if (progressionTimerRef.current !== null) {
        clearInterval(progressionTimerRef.current);
        progressionTimerRef.current = null;
      }
      setProgressionPlaying(false);
      setProgressionStep(-1);
      return;
    }

    const progression = PROGRESSIONS[progressionIndex];
    const engine = getAudioEngine();
    let step = 0;

    setProgressionPlaying(true);
    setProgressionStep(0);

    const playStep = () => {
      if (step >= progression.degrees.length) {
        if (progressionTimerRef.current !== null) {
          clearInterval(progressionTimerRef.current);
          progressionTimerRef.current = null;
        }
        setProgressionPlaying(false);
        setProgressionStep(-1);
        return;
      }

      const degree = progression.degrees[step];
      const quality = progression.qualities[step];
      const chordDef = CHORDS.find((c) => c.name === quality) ?? CHORDS[0];
      const chordRoot = (rootNote + degree) % 12;
      const midiNotes = chordDef.intervals.map((interval) => {
        return noteToMidi((chordRoot + interval) % 12, OCTAVE_START);
      });

      playChordNotes(engine, midiNotes, waveform, adsr, "block");
      setProgressionStep(step);
      step++;
    };

    playStep();
    progressionTimerRef.current = window.setInterval(playStep, 800);
  }, [progressionIndex, progressionPlaying, rootNote, waveform, adsr, getAudioEngine]);

  // Interval display
  const intervalSemitones =
    intervalStart !== null && intervalEnd !== null
      ? Math.abs(intervalEnd - intervalStart)
      : null;

  // Styles
  const panelStyle = {
    backgroundColor: isDark ? "rgba(17,17,17,0.8)" : "rgba(255,255,255,0.9)",
    border: `1px solid ${isDark ? "#27272a" : "#e5e5e5"}`,
    borderRadius: "8px",
    padding: "16px",
  };

  const selectStyle = {
    backgroundColor: isDark ? "#1a1a2e" : "#f5f5f5",
    color: isDark ? "#e4e4e7" : "#333",
    border: `1px solid ${isDark ? "#333" : "#ccc"}`,
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "13px",
    outline: "none",
  };

  const buttonStyle = (active: boolean = false) => ({
    backgroundColor: active ? "#4f8ff7" : isDark ? "#1a1a2e" : "#f5f5f5",
    color: active ? "#fff" : isDark ? "#e4e4e7" : "#333",
    border: `1px solid ${active ? "#4f8ff7" : isDark ? "#333" : "#ccc"}`,
    borderRadius: "6px",
    padding: "6px 14px",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
    transition: "all 0.15s ease",
  });

  const labelStyle = {
    color: isDark ? "#a1a1aa" : "#666",
    fontSize: "11px",
    fontWeight: 500 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Controls Row */}
      <div style={panelStyle}>
        <div class="flex flex-wrap items-end gap-4">
          {/* Root Note */}
          <div class="flex flex-col gap-1">
            <label style={labelStyle}>Root Note</label>
            <select
              style={selectStyle}
              value={rootNote}
              onChange={(e) => setRootNote(parseInt((e.target as HTMLSelectElement).value))}
            >
              {NOTE_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>

          {/* Scale */}
          <div class="flex flex-col gap-1">
            <label style={labelStyle}>Scale</label>
            <select
              style={selectStyle}
              value={scaleIndex}
              onChange={(e) => setScaleIndex(parseInt((e.target as HTMLSelectElement).value))}
            >
              {SCALES.map((s, i) => (
                <option key={i} value={i}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Chord */}
          <div class="flex flex-col gap-1">
            <label style={labelStyle}>Chord</label>
            <select
              style={selectStyle}
              value={chordIndex}
              onChange={(e) => setChordIndex(parseInt((e.target as HTMLSelectElement).value))}
            >
              {CHORDS.map((c, i) => (
                <option key={i} value={i}>{getNoteName(rootNote)}{c.symbol} ({c.name})</option>
              ))}
            </select>
          </div>

          {/* Waveform */}
          <div class="flex flex-col gap-1">
            <label style={labelStyle}>Waveform</label>
            <select
              style={selectStyle}
              value={waveform}
              onChange={(e) => setWaveform((e.target as HTMLSelectElement).value as WaveformType)}
            >
              <option value="sine">Sine</option>
              <option value="triangle">Triangle</option>
              <option value="sawtooth">Sawtooth</option>
              <option value="square">Square</option>
            </select>
          </div>

          {/* Chord Play Mode */}
          <div class="flex flex-col gap-1">
            <label style={labelStyle}>Chord Mode</label>
            <div class="flex gap-1">
              <button
                type="button"
                style={buttonStyle(chordPlayMode === "block")}
                onClick={() => setChordPlayMode("block")}
              >
                Block
              </button>
              <button
                type="button"
                style={buttonStyle(chordPlayMode === "arpeggio")}
                onClick={() => setChordPlayMode("arpeggio")}
              >
                Arpeggio
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div class="flex gap-2">
        {(["keyboard", "circle", "staff"] as ViewTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            style={buttonStyle(activeTab === tab)}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "keyboard" ? "Piano" : tab === "circle" ? "Circle of 5ths" : "Staff"}
          </button>
        ))}
      </div>

      {/* Main Visualization Area */}
      <div style={panelStyle}>
        {/* Piano Keyboard */}
        {activeTab === "keyboard" && (
          <div>
            <canvas
              ref={pianoCanvasRef}
              onClick={handlePianoClick}
              style={{
                width: "100%",
                height: "164px",
                cursor: "pointer",
                display: "block",
              }}
            />
            {/* Scale notes display */}
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <span style={{ ...labelStyle, marginRight: "4px" }}>
                {getNoteName(rootNote)} {currentScale.name}:
              </span>
              {getScaleNotes(rootNote, currentScale).map((n, i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: "26px",
                    height: "24px",
                    borderRadius: "4px",
                    backgroundColor: isDark ? "rgba(52,211,153,0.2)" : "rgba(52,211,153,0.3)",
                    color: isDark ? "#e4e4e7" : "#333",
                    fontSize: "11px",
                    fontWeight: 500,
                    padding: "0 4px",
                  }}
                >
                  {getNoteName(n)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Circle of Fifths */}
        {activeTab === "circle" && (
          <CircleOfFifths
            rootNote={rootNote}
            scaleNotes={scaleNotes}
            onSelectRoot={setRootNote}
            isDark={isDark}
          />
        )}

        {/* Staff Notation */}
        {activeTab === "staff" && (
          <div>
            <canvas
              ref={staffCanvasRef}
              style={{
                width: "100%",
                height: "140px",
                display: "block",
              }}
            />
            <div class="mt-2">
              <ChordDiagram rootNote={rootNote} chord={currentChord} isDark={isDark} />
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div class="flex flex-wrap gap-2">
        <button type="button" style={buttonStyle(false)} onClick={handlePlayScale}>
          Play Scale
        </button>
        <button type="button" style={buttonStyle(false)} onClick={handlePlayChord}>
          Play Chord
        </button>
        <button
          type="button"
          style={buttonStyle(intervalMode)}
          onClick={() => {
            setIntervalMode(!intervalMode);
            setIntervalStart(null);
            setIntervalEnd(null);
          }}
        >
          {intervalMode ? "Exit Interval Mode" : "Interval Finder"}
        </button>
      </div>

      {/* Interval Result */}
      {intervalMode && (
        <div style={panelStyle}>
          <p style={{ color: isDark ? "#a1a1aa" : "#666", fontSize: "12px", marginBottom: "8px" }}>
            Click two notes on the piano to measure the interval between them.
          </p>
          {intervalSemitones !== null && intervalStart !== null && intervalEnd !== null ? (
            <div style={{ color: isDark ? "#e4e4e7" : "#333", fontSize: "14px" }}>
              <span style={{ fontWeight: 600 }}>
                {getNoteName(intervalStart % 12)} to {getNoteName(intervalEnd % 12)}
              </span>
              {" = "}
              <span style={{ color: "#34d399", fontWeight: 600 }}>
                {getIntervalName(intervalSemitones)}
              </span>
              <span style={{ color: isDark ? "#888" : "#999", marginLeft: "8px" }}>
                ({intervalSemitones} semitone{intervalSemitones !== 1 ? "s" : ""})
              </span>
            </div>
          ) : (
            <div style={{ color: isDark ? "#666" : "#aaa", fontSize: "13px" }}>
              {intervalStart !== null
                ? `First note: ${getNoteName(intervalStart % 12)} — now click the second note`
                : "Click the first note..."}
            </div>
          )}
        </div>
      )}

      {/* Chord Progressions */}
      <div style={panelStyle}>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <label style={labelStyle}>Chord Progression</label>
            <select
              style={selectStyle}
              value={progressionIndex}
              onChange={(e) => setProgressionIndex(parseInt((e.target as HTMLSelectElement).value))}
              disabled={progressionPlaying}
            >
              {PROGRESSIONS.map((p, i) => (
                <option key={i} value={i}>{p.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            style={buttonStyle(progressionPlaying)}
            onClick={handlePlayProgression}
          >
            {progressionPlaying ? "Stop" : "Play Progression"}
          </button>
        </div>

        {/* Progression chord display */}
        <div class="mt-3 flex flex-wrap gap-2">
          {PROGRESSIONS[progressionIndex].degrees.map((degree, i) => {
            const quality = PROGRESSIONS[progressionIndex].qualities[i];
            const chordRoot = (rootNote + degree) % 12;
            const chordDef = CHORDS.find((c) => c.name === quality) ?? CHORDS[0];
            const isActive = progressionStep === i;

            // Compute roman numeral based on scale degree
            const scaleIntervals = SCALES[0].intervals; // Major scale for degree labels
            const degreeIdx = scaleIntervals.indexOf(degree);
            const roman = degreeIdx >= 0
              ? getDegreeRoman(degreeIdx, quality)
              : getNoteName(chordRoot);

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  backgroundColor: isActive
                    ? "#4f8ff7"
                    : isDark
                      ? "#1a1a2e"
                      : "#f5f5f5",
                  border: `1px solid ${isActive ? "#4f8ff7" : isDark ? "#333" : "#ccc"}`,
                  transition: "all 0.2s ease",
                  minWidth: "48px",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: isActive ? "#fff" : isDark ? "#e4e4e7" : "#333",
                  }}
                >
                  {roman}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: isActive ? "rgba(255,255,255,0.7)" : isDark ? "#888" : "#999",
                  }}
                >
                  {getNoteName(chordRoot)}{chordDef.symbol}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scale Degrees / Chord Quality Table */}
      <div style={panelStyle}>
        <label style={{ ...labelStyle, marginBottom: "8px", display: "block" }}>
          Diatonic Chords in {getNoteName(rootNote)} Major
        </label>
        <div class="flex flex-wrap gap-2">
          {MAJOR_SCALE_QUALITIES.map((quality, i) => {
            const degree = SCALES[0].intervals[i]; // Major scale intervals
            const chordRoot = (rootNote + degree) % 12;
            const chordDef = CHORDS.find((c) => c.name === quality) ?? CHORDS[0];
            const roman = getDegreeRoman(i, quality);

            return (
              <button
                key={i}
                type="button"
                style={{
                  ...buttonStyle(false),
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                  minWidth: "52px",
                  padding: "8px 10px",
                }}
                onClick={() => {
                  const engine = getAudioEngine();
                  const midiNotes = chordDef.intervals.map((interval) =>
                    noteToMidi((chordRoot + interval) % 12, OCTAVE_START),
                  );
                  playChordNotes(engine, midiNotes, waveform, adsr, chordPlayMode);
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "13px" }}>{roman}</span>
                <span style={{ fontSize: "10px", opacity: 0.7 }}>
                  {getNoteName(chordRoot)}{chordDef.symbol}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
