import { describe, expect, it } from 'vitest';
import {
  barSeconds,
  CHORD_VOICINGS,
  chordForBar,
  chordNameForBar,
  degreeToMidi,
  midiToFreq,
  PHRASES,
  phraseForBar,
  phraseNoteToMidi,
  SCORE_SECTIONS,
  SECTION_ORDER,
  selectSection,
  TONIC,
} from '../src/audio/score';

describe('v0.3 score harmony', () => {
  it('walks the D natural minor scale from the tonic', () => {
    // D E F G A Bb C, then the octave.
    expect(degreeToMidi(0)).toBe(TONIC);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((step) => degreeToMidi(step) - TONIC)).toEqual([
      0, 2, 3, 5, 7, 8, 10, 12,
    ]);
    expect(degreeToMidi(7) - degreeToMidi(0)).toBe(12);
    expect(degreeToMidi(-1)).toBe(TONIC - 2);
    expect(degreeToMidi(14) - degreeToMidi(7)).toBe(12);
  });

  it('anchors the octave to concert pitch', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
  });

  it('keeps every section in the chord book and on a real phrase', () => {
    for (const id of SECTION_ORDER) {
      const section = SCORE_SECTIONS[id];
      expect(section, id).toBeDefined();
      expect(section.bpm).toBeGreaterThan(40);
      expect(section.progression.length).toBeGreaterThan(1);
      // One written phrase per bar of the progression, so a cycle never repeats
      // a bar by accident.
      expect(section.programme.length, id).toBe(section.progression.length);
      for (const chord of section.progression) {
        expect(Object.keys(CHORD_VOICINGS), `${id}/${chord}`).toContain(chord);
      }
      for (const index of section.programme) {
        expect(PHRASES[index], `${id} phrase ${index}`).toBeDefined();
      }
      expect(section.energy).toBeGreaterThanOrEqual(0);
      expect(section.energy).toBeLessThanOrEqual(1);
    }
  });

  it('cycles the progression and the phrase programme without drifting', () => {
    const section = SCORE_SECTIONS.dogfight;
    const cycle = section.progression.length;
    expect(chordNameForBar(section, 0)).toBe(section.progression[0]);
    expect(chordNameForBar(section, cycle)).toBe(section.progression[0]);
    expect(chordNameForBar(section, cycle * 3 + 2)).toBe(section.progression[2]);
    expect(chordForBar(section, 0)).toEqual([...CHORD_VOICINGS[section.progression[0]!]]);
    // Negative bars must not index out of the array.
    expect(chordNameForBar(section, -1)).toBe(section.progression[cycle - 1]);
    expect(phraseForBar(section, 0).id).toBe(PHRASES[section.programme[0]!]!.id);
    expect(phraseForBar(section, cycle).id).toBe(PHRASES[section.programme[0]!]!.id);
  });

  it('keeps the lead inside a singable register for every section', () => {
    for (const id of SECTION_ORDER) {
      const section = SCORE_SECTIONS[id];
      for (const phrase of PHRASES) {
        for (const note of phrase.notes) {
          const midi = phraseNoteToMidi(section, note);
          expect(midi, `${id}/${phrase.id}`).toBeGreaterThanOrEqual(62);
          expect(midi, `${id}/${phrase.id}`).toBeLessThanOrEqual(88);
        }
      }
    }
  });

  it('phrases stay inside one or two bars so the arranger can tile them', () => {
    for (const phrase of PHRASES) {
      expect(phrase.span, phrase.id).toBeGreaterThan(0);
      expect(phrase.span, phrase.id).toBeLessThanOrEqual(4);
      for (const note of phrase.notes) {
        expect(note.beat, `${phrase.id}@${note.beat}`).toBeLessThan(phrase.span);
        expect(note.length, `${phrase.id}@${note.beat}`).toBeGreaterThan(0);
        expect(note.accent).toBeGreaterThan(0);
        expect(note.accent).toBeLessThanOrEqual(1);
      }
    }
  });

  it('derives bar length from the tempo', () => {
    expect(barSeconds(SCORE_SECTIONS.soar)).toBeCloseTo((60 / 62) * 4, 6);
    expect(barSeconds(SCORE_SECTIONS.boss)).toBeLessThan(barSeconds(SCORE_SECTIONS.soar));
  });

  it('gives every percussion pattern sixteenths inside one bar', () => {
    for (const id of SECTION_ORDER) {
      const pattern = SCORE_SECTIONS[id].percussion;
      for (const lane of [pattern.kick, pattern.snare, pattern.hat, pattern.tom, pattern.crash]) {
        for (const step of lane) {
          expect(Number.isInteger(step), `${id} step ${step}`).toBe(true);
          expect(step).toBeGreaterThanOrEqual(0);
          expect(step).toBeLessThan(16);
        }
      }
    }
  });
});

describe('v0.3 score drama', () => {
  const base = { elapsed: 60, intensity: 0.5 };

  it('follows the mission phase into the right cue', () => {
    expect(selectSection({ ...base, phase: 'idle' }).section).toBe('soar');
    expect(selectSection({ ...base, phase: 'boot' }).section).toBe('soar');
    expect(selectSection({ ...base, phase: 'complete' }).section).toBe('victory');
    expect(selectSection({ ...base, phase: 'failed' }).section).toBe('elegy');
    expect(selectSection({ ...base, phase: 'boss' }).section).toBe('boss');
    const intro = selectSection({ ...base, phase: 'boss-intro' });
    expect(intro.section).toBe('assault');
    // The intro is the only place the riser fires, so the boss lands as a step up.
    expect(intro.riser).toBe(true);
    expect(selectSection({ ...base, phase: 'boss' }).riser).toBe(false);
  });

  it('opens the mission soaring before it commits to the combat material', () => {
    expect(selectSection({ phase: 'dogfight', elapsed: 6, intensity: 0.3 }).section).toBe('soar');
    // Same intensity, but inside the opening window the cue stays wide.
    expect(selectSection({ phase: 'dogfight', elapsed: 6, intensity: 0.48 }).section).toBe('soar');
    // Past the opening that identical intensity escalates to the combat cue.
    expect(selectSection({ phase: 'dogfight', elapsed: 90, intensity: 0.48 }).section).toBe('dogfight');
    expect(selectSection({ phase: 'dogfight', elapsed: 90, intensity: 0.6 }).section).toBe('dogfight');
    expect(selectSection({ phase: 'dogfight', elapsed: 90, intensity: 0.9 }).section).toBe('assault');
  });

  it('escalates monotonically with intensity inside the dogfight', () => {
    const order = ['soar', 'dogfight', 'assault'];
    let previous = -1;
    for (const intensity of [0.1, 0.3, 0.5, 0.9]) {
      const index = order.indexOf(
        selectSection({ phase: 'dogfight', elapsed: 120, intensity }).section,
      );
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    expect(previous).toBe(order.length - 1);
  });

  it('gives the epic sections the heaviest arrangement', () => {
    const soar = SCORE_SECTIONS.soar;
    const boss = SCORE_SECTIONS.boss;
    expect(boss.energy).toBeGreaterThan(soar.energy);
    expect(boss.percussion.kick.length).toBeGreaterThan(soar.percussion.kick.length);
    expect(boss.ostinato).toBe('sixteenth');
    expect(soar.ostinato).toBe('none');
    expect(boss.choir).toBe(true);
    expect(soar.choir).toBe(false);
    expect(boss.brass).toBeGreaterThan(soar.brass);
  });
});
