import type { MissionPhase } from '../sim/types';

/**
 * THEVE // TACS-8 — v0.3 generative score.
 *
 * The v0.1/v0.2 "music" was a four-chord drone with a pulse on top. v0.3 replaces
 * it with a real arranger: six hand-written sections over a D-minor tonality,
 * ten singable phrases that transpose under the harmony, a taiko/string
 * percussion book and a bar-locked clock so the vertical layers stay in time.
 *
 * Everything in this module is pure data and pure functions — no WebAudio — so
 * the arrangement can be unit-tested and reviewed like a score rather than
 * debugged through a speaker. `AudioEngine` is the only thing that renders it.
 */

/** D3 — the tonic the whole score is written around. */
export const TONIC = 50;

/** Natural-minor semitone offsets from the tonic (D E F G A Bb C). */
const DEGREE_SEMITONES = [0, 2, 3, 5, 7, 8, 10] as const;

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Turn a diatonic step into a MIDI note. Step 0 is the tonic an octave below
 * middle C, step 7 is the octave above, negative steps descend.
 */
export function degreeToMidi(step: number, root: number = TONIC): number {
  const octave = Math.floor(step / 7);
  const index = ((step % 7) + 7) % 7;
  return root + octave * 12 + (DEGREE_SEMITONES[index] ?? 0);
}

/** Chord voicings, bass note first, then the pad triad, then an upper colour tone. */
export const CHORD_VOICINGS = {
  Dm: [38, 50, 53, 57, 62],
  Bb: [34, 46, 50, 53, 58],
  F: [41, 45, 48, 53, 57],
  C: [36, 48, 52, 55, 60],
  Gm: [43, 50, 55, 58, 62],
  Am: [45, 52, 57, 60, 64],
} as const;

export type ChordName = keyof typeof CHORD_VOICINGS;

/* ------------------------------------------------------------------ */
/* phrases                                                             */
/* ------------------------------------------------------------------ */

export interface PhraseNote {
  /** Diatonic step from the tonic; 7 is the octave above step 0. */
  step: number;
  /** Offset from the phrase start, in beats. */
  beat: number;
  /** Duration in beats. */
  length: number;
  /** Relative dynamics, 0..1. */
  accent: number;
  /** Slide into the note from a semitone below — the "soaring" gesture. */
  glide?: boolean;
}

export interface Phrase {
  id: string;
  labelZh: string;
  /** Total length in beats. Bars are four beats, so 4 = one bar, 2 = half a bar. */
  span: number;
  notes: PhraseNote[];
}

/**
 * Ten written phrases. They are deliberately diatomic to D natural minor so any
 * of them sits over any chord in the book; the harmony moves underneath a
 * mostly stepwise melodic line, which is what makes the result read as a tune
 * instead of a random walk.
 */
export const PHRASES: Phrase[] = [
  {
    id: 'theve',
    labelZh: 'THEVE 动机',
    span: 4,
    notes: [
      { step: 0, beat: 0, length: 1, accent: 0.82 },
      { step: 2, beat: 1, length: 1, accent: 0.7 },
      { step: 4, beat: 2, length: 1, accent: 0.86 },
      { step: 7, beat: 3, length: 1, accent: 1, glide: true },
    ],
  },
  {
    id: 'dawn',
    labelZh: '黎明',
    span: 4,
    notes: [
      { step: 4, beat: 0, length: 1.5, accent: 0.78, glide: true },
      { step: 2, beat: 1.5, length: 0.5, accent: 0.58 },
      { step: 0, beat: 2, length: 2, accent: 0.84 },
    ],
  },
  {
    id: 'arch',
    labelZh: '拱形',
    span: 4,
    notes: [
      { step: 2, beat: 0, length: 1, accent: 0.6 },
      { step: 4, beat: 1, length: 1, accent: 0.76 },
      { step: 5, beat: 2, length: 1, accent: 0.88 },
      { step: 4, beat: 3, length: 1, accent: 0.66 },
    ],
  },
  {
    id: 'call',
    labelZh: '呼唤',
    span: 4,
    notes: [
      { step: 7, beat: 0, length: 0.5, accent: 0.94, glide: true },
      { step: 6, beat: 0.5, length: 0.5, accent: 0.7 },
      { step: 4, beat: 1, length: 2, accent: 0.9 },
      { step: 2, beat: 3, length: 1, accent: 0.6 },
    ],
  },
  {
    id: 'resolve',
    labelZh: '落定',
    span: 4,
    notes: [
      { step: 4, beat: 0, length: 2, accent: 0.8 },
      { step: 3, beat: 2, length: 1, accent: 0.62 },
      { step: 2, beat: 3, length: 1, accent: 0.56 },
    ],
  },
  {
    id: 'climb',
    labelZh: '攀升',
    span: 2,
    notes: [
      { step: 0, beat: 0, length: 0.5, accent: 0.58 },
      { step: 1, beat: 0.5, length: 0.5, accent: 0.64 },
      { step: 2, beat: 1, length: 0.5, accent: 0.72 },
      { step: 4, beat: 1.5, length: 0.5, accent: 0.84 },
    ],
  },
  {
    id: 'soar',
    labelZh: '翱翔',
    span: 4,
    notes: [
      { step: 7, beat: 0, length: 2, accent: 0.92, glide: true },
      { step: 5, beat: 2, length: 1, accent: 0.74 },
      { step: 6, beat: 3, length: 1, accent: 0.68 },
    ],
  },
  {
    id: 'storm',
    labelZh: '风暴',
    span: 4,
    notes: [
      { step: 5, beat: 0, length: 0.5, accent: 0.86 },
      { step: 6, beat: 0.5, length: 0.5, accent: 0.8 },
      { step: 7, beat: 1, length: 1, accent: 0.98, glide: true },
      { step: 4, beat: 2, length: 2, accent: 0.82 },
    ],
  },
  {
    id: 'lament',
    labelZh: '挽歌',
    span: 4,
    notes: [
      { step: 2, beat: 0, length: 1.5, accent: 0.5 },
      { step: 1, beat: 1.5, length: 0.5, accent: 0.44 },
      { step: 0, beat: 2, length: 2, accent: 0.56 },
    ],
  },
  {
    id: 'pedal',
    labelZh: '持续音',
    span: 4,
    notes: [{ step: 4, beat: 0, length: 4, accent: 0.46 }],
  },
];

/* ------------------------------------------------------------------ */
/* percussion                                                          */
/* ------------------------------------------------------------------ */

/** Step indices are 16th notes inside one 4/4 bar, 0..15. */
export interface PercussionPattern {
  kick: number[];
  snare: number[];
  hat: number[];
  tom: number[];
  crash: number[];
}

const PATTERNS: Record<string, PercussionPattern> = {
  none: { kick: [], snare: [], hat: [], tom: [], crash: [] },
  /** Distant war drums — present, but never in front of the melody. */
  soft: {
    kick: [0, 8],
    snare: [8],
    hat: [4, 12],
    tom: [],
    crash: [],
  },
  /** Marching kit for the mid-intensity dogfight. */
  march: {
    kick: [0, 6, 8, 14],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    tom: [11],
    crash: [0],
  },
  /** Full assault: driving taiko with off-beat toms. */
  assault: {
    kick: [0, 2, 6, 8, 10, 14],
    snare: [4, 12],
    hat: [1, 3, 5, 7, 9, 11, 13, 15],
    tom: [7, 15],
    crash: [0],
  },
  /** Boss set piece: double-kick taiko, tom flourishes, crash on every other bar. */
  boss: {
    kick: [0, 3, 6, 8, 11, 14],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    tom: [7, 15],
    crash: [0, 8],
  },
};

/* ------------------------------------------------------------------ */
/* sections                                                            */
/* ------------------------------------------------------------------ */

export type SectionId = 'soar' | 'dogfight' | 'assault' | 'boss' | 'victory' | 'elegy';

export interface ScoreSection {
  id: SectionId;
  labelZh: string;
  /** Human-readable intent, surfaced in the systems page. */
  intent: string;
  bpm: number;
  /** One chord per bar; the progression loops. */
  progression: ChordName[];
  /** Index into PHRASES for each bar of the progression cycle. */
  programme: number[];
  /** Octave offset applied to the lead line. */
  leadOctave: number;
  /** 0..1 arrangement density — scales how many layers are voiced. */
  energy: number;
  percussion: PercussionPattern;
  /** Sixteenth-note low-string ostinato. */
  ostinato: 'none' | 'eighth' | 'sixteenth';
  /** Layer mix, 0..1. */
  pad: number;
  harp: number;
  brass: number;
  /** Adds a sustained choral fifth above the pad — the "epic" colour. */
  choir: boolean;
}

export const SCORE_SECTIONS: Record<SectionId, ScoreSection> = {
  soar: {
    id: 'soar',
    labelZh: '翱翔',
    intent: '巡航与开场：只有弦乐与长线条独奏，留出天空的宽度。',
    bpm: 62,
    progression: ['Dm', 'Bb', 'F', 'C'],
    programme: [1, 3, 2, 4],
    leadOctave: 0,
    energy: 0.24,
    percussion: PATTERNS.none!,
    ostinato: 'none',
    pad: 0.9,
    harp: 0.55,
    brass: 0,
    choir: false,
  },
  dogfight: {
    id: 'dogfight',
    labelZh: '制空',
    intent: '交战：行进鼓点与八分音符弦乐固定音型，旋律仍保持可唱。',
    bpm: 88,
    progression: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'Am'],
    programme: [0, 5, 2, 3, 0, 5, 6, 2],
    leadOctave: 0,
    energy: 0.58,
    percussion: PATTERNS.march!,
    ostinato: 'eighth',
    pad: 0.72,
    harp: 0.34,
    brass: 0.32,
    choir: false,
  },
  assault: {
    id: 'assault',
    labelZh: '强攻',
    intent: '高张力：十六分音符固定音型、铜管重音与太鼓推进。',
    bpm: 100,
    progression: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Gm', 'Bb', 'Am'],
    programme: [0, 7, 3, 6, 0, 7, 5, 2],
    leadOctave: 1,
    energy: 0.82,
    percussion: PATTERNS.assault!,
    ostinato: 'sixteenth',
    pad: 0.6,
    harp: 0.2,
    brass: 0.6,
    choir: true,
  },
  boss: {
    id: 'boss',
    labelZh: '巨兽',
    intent: 'LEVIATHAN：史诗段——低音铜管、合唱层与双踩太鼓，旋律用最高音区。',
    bpm: 108,
    progression: ['Dm', 'Dm', 'Bb', 'Gm', 'F', 'C', 'Gm', 'Am'],
    programme: [0, 7, 3, 7, 5, 6, 7, 2],
    leadOctave: 1,
    energy: 1,
    percussion: PATTERNS.boss!,
    ostinato: 'sixteenth',
    pad: 0.86,
    harp: 0.16,
    brass: 0.72,
    choir: true,
  },
  victory: {
    id: 'victory',
    labelZh: '凯旋',
    intent: '结算：相对大调的赞美诗式进行，竖琴琶音收束，全曲唯一不带鼓的收尾。',
    bpm: 84,
    progression: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'F', 'F'],
    programme: [0, 3, 6, 4, 0, 3, 2, 4],
    leadOctave: 1,
    energy: 0.7,
    percussion: PATTERNS.none!,
    ostinato: 'eighth',
    pad: 0.94,
    harp: 0.72,
    brass: 0.3,
    choir: true,
  },
  elegy: {
    id: 'elegy',
    labelZh: '挽歌',
    intent: '失败：稀疏、下行的线条，只留低音弦乐与一支独奏。',
    bpm: 56,
    progression: ['Dm', 'Gm', 'Dm', 'Am'],
    programme: [8, 1, 8, 2],
    leadOctave: 0,
    energy: 0.16,
    percussion: PATTERNS.none!,
    ostinato: 'none',
    pad: 0.8,
    harp: 0.24,
    brass: 0,
    choir: false,
  },
};

export const SECTION_ORDER: SectionId[] = [
  'soar',
  'dogfight',
  'assault',
  'boss',
  'victory',
  'elegy',
];

/* ------------------------------------------------------------------ */
/* arrangement helpers                                                 */
/* ------------------------------------------------------------------ */

export function barSeconds(section: ScoreSection): number {
  return (60 / section.bpm) * 4;
}

export function chordForBar(section: ScoreSection, bar: number): number[] {
  const name = section.progression[((bar % section.progression.length) + section.progression.length) % section.progression.length];
  const voicing = CHORD_VOICINGS[name ?? 'Dm'];
  return [...voicing];
}

export function chordNameForBar(section: ScoreSection, bar: number): ChordName {
  const index =
    ((bar % section.progression.length) + section.progression.length) %
    section.progression.length;
  return section.progression[index] ?? 'Dm';
}

export function phraseForBar(section: ScoreSection, bar: number): Phrase {
  const index =
    ((bar % section.programme.length) + section.programme.length) % section.programme.length;
  const phraseIndex = section.programme[index] ?? 0;
  return PHRASES[phraseIndex] ?? PHRASES[0]!;
}

/**
 * Resolve a phrase note to a MIDI pitch, clamped to a playable lead register so
 * a "storm" phrase in the boss section does not run off the top of the keyboard.
 */
export function phraseNoteToMidi(
  section: ScoreSection,
  note: PhraseNote,
  minMidi = 62,
  maxMidi = 88,
): number {
  let midi = degreeToMidi(note.step) + section.leadOctave * 12;
  while (midi < minMidi) midi += 12;
  while (midi > maxMidi) midi -= 12;
  return midi;
}

/* ------------------------------------------------------------------ */
/* dramatic selection                                                  */
/* ------------------------------------------------------------------ */

export interface SectionPick {
  section: SectionId;
  /** True when the boss intro should fire a riser over the section change. */
  riser: boolean;
}

/**
 * Pick the section that matches the mission right now. The simulation owns the
 * 0..1 `intensity` number (see `AudioTelemetry.intensity`); the score only
 * decides what that number should sound like. Boss intro deliberately lands on
 * `assault` so the transition into `boss` is a step up rather than a lateral move.
 */
export function selectSection(telemetry: {
  phase: MissionPhase;
  elapsed: number;
  intensity: number;
}): SectionPick {
  const phase = telemetry.phase;
  if (phase === 'complete') return { section: 'victory', riser: false };
  if (phase === 'failed') return { section: 'elegy', riser: false };
  if (phase === 'boss-intro') return { section: 'assault', riser: true };
  if (phase === 'boss') return { section: 'boss', riser: false };
  if (phase === 'idle' || phase === 'boot') return { section: 'soar', riser: false };
  // Early in the mission the picture is still wide: stay soaring before the
  // arrangement commits to the combat material.
  if (telemetry.elapsed < 26 && telemetry.intensity < 0.5) {
    return { section: 'soar', riser: false };
  }
  if (telemetry.intensity < 0.46) return { section: 'soar', riser: false };
  if (telemetry.intensity < 0.74) return { section: 'dogfight', riser: false };
  return { section: 'assault', riser: false };
}
