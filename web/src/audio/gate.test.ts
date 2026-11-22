import { describe, expect, test } from 'vitest';
import { FRAME_SIZE } from './rnnoise';
import { DEFAULT_GATE, Gate } from './gate';

/** Frame mit Kennwert i (alle Samples = i / 1000), damit sich Reihenfolgen prüfen lassen. */
const frame = (i: number) => new Float32Array(FRAME_SIZE).fill(i / 1000);
const isZero = (f: Float32Array) => f.every((v) => v === 0);
const id = (f: Float32Array) => Math.round(f[0] * 1000);

/** Speist VAD-Werte ein (Frame-Kennwert = laufende Nummer ab start) und liefert alle ausgegebenen Frames. */
function run(g: Gate, vads: number[], start = 1): Float32Array[] {
  return vads.flatMap((v, k) => g.process(frame(start + k), v));
}
const voiced = (out: Float32Array[]) => out.filter((f) => !isZero(f)).length;

test('Standardwerte aus der Spezifikation', () => {
  expect(DEFAULT_GATE).toEqual({ pttTailMs: 150, vadHoldMs: 400, prerollMs: 200, threshold: 0.85, preroll: true });
});

describe('Sprachaktivierung', () => {
  test('unter der Schwelle bleibt das Gate zu, je ein Nullframe', () => {
    const g = new Gate();
    const out = run(g, Array(30).fill(0.5));
    expect(out).toHaveLength(30);
    expect(voiced(out)).toBe(0);
    expect(g.open).toBe(false);
  });

  test('öffnet über der Schwelle, schließt erst beim 40. Frame darunter (400 ms)', () => {
    const g = new Gate({ preroll: false });
    run(g, [0.9]);
    expect(g.open).toBe(true);
    const hold = run(g, Array(39).fill(0.6), 100);
    expect(voiced(hold)).toBe(39);
    expect(g.open).toBe(true);
    const last = run(g, [0.6], 200);
    expect(voiced(last)).toBe(0);
    expect(g.open).toBe(false);
  });

  test('mit Vorlauf kommen beim Öffnen die 20 vorherigen Frames in Reihenfolge vor dem aktuellen', () => {
    const g = new Gate();
    run(g, Array(25).fill(0.1), 1); // Frames 1..25, zu
    const out = g.process(frame(26), 0.95);
    expect(out.map(id)).toEqual([...Array(20).keys()].map((k) => k + 6).concat(26));
    expect(g.lagFrames).toBe(20);
  });

  test('ohne Vorlauf genau ein Frame beim Öffnen', () => {
    const g = new Gate({ preroll: false });
    run(g, Array(25).fill(0.1));
    expect(g.process(frame(26), 0.95).map(id)).toEqual([26]);
    expect(g.lagFrames).toBe(0);
  });

  test('Rückstand wird in Pausen zwischen Wörtern abgebaut, ohne zu schließen', () => {
    const g = new Gate();
    run(g, Array(20).fill(0.1));
    run(g, [0.95], 50);
    expect(g.lagFrames).toBe(20);
    const pause = run(g, Array(20).fill(0.1), 100);
    expect(pause).toHaveLength(0);
    expect(g.lagFrames).toBe(0);
    expect(g.open).toBe(true);
    expect(run(g, [0.1], 200)).toHaveLength(1);
  });

  test('Frames knapp unter der Schwelle werden nicht verworfen, nur echte Pausen', () => {
    const g = new Gate();
    run(g, Array(20).fill(0.1));
    run(g, [0.95], 50);
    expect(run(g, Array(5).fill(0.6), 100)).toHaveLength(5);
    expect(g.lagFrames).toBe(20);
  });

  test('Schließen setzt den Rückstand zurück', () => {
    const g = new Gate();
    run(g, Array(20).fill(0.1));
    run(g, [0.95], 50);
    run(g, Array(40).fill(0.6), 100);
    expect(g.open).toBe(false);
    expect(g.lagFrames).toBe(0);
  });

  test('Schwelle ist einstellbar', () => {
    const g = new Gate({ preroll: false });
    run(g, [0.6]);
    expect(g.open).toBe(false);
    g.set({ threshold: 0.5 });
    run(g, [0.6]);
    expect(g.open).toBe(true);
  });
});

describe('Push-to-Talk', () => {
  test('ungedrückt zu, auch bei VAD 1', () => {
    const g = new Gate();
    g.mode = 'ptt';
    expect(voiced(run(g, Array(10).fill(1)))).toBe(0);
  });

  test('gedrückt offen unabhängig von VAD, ohne Vorlauf', () => {
    const g = new Gate();
    g.mode = 'ptt';
    run(g, Array(25).fill(0));
    g.setPressed(true);
    const out = run(g, [0, 0, 0], 100);
    expect(out.map(id)).toEqual([100, 101, 102]);
    expect(g.lagFrames).toBe(0);
  });

  test('nach dem Loslassen noch 15 Frames offen (150 ms), der 16. ist Null', () => {
    const g = new Gate();
    g.mode = 'ptt';
    g.setPressed(true);
    run(g, [0]);
    g.setPressed(false);
    const tail = run(g, Array(16).fill(0), 10);
    expect(tail.slice(0, 15).every((f) => !isZero(f))).toBe(true);
    expect(isZero(tail[15])).toBe(true);
    expect(g.open).toBe(false);
  });

  test('erneutes Drücken im Nachlauf hält offen', () => {
    const g = new Gate();
    g.mode = 'ptt';
    g.setPressed(true);
    g.setPressed(false);
    run(g, Array(10).fill(0));
    g.setPressed(true);
    expect(voiced(run(g, Array(30).fill(0)))).toBe(30);
  });
});

describe('Stumm und Moduswechsel', () => {
  test('stumm ist immer zu', () => {
    const g = new Gate();
    g.mode = 'muted';
    g.setPressed(true);
    expect(voiced(run(g, Array(10).fill(1)))).toBe(0);
  });

  test('Wechsel von offener Sprachaktivierung nach Stumm schließt sofort', () => {
    const g = new Gate();
    run(g, [0.95]);
    expect(g.open).toBe(true);
    g.mode = 'muted';
    expect(g.open).toBe(false);
    expect(voiced(run(g, [0.95]))).toBe(0);
  });
});

test('ausgegebene Frames sind Kopien', () => {
  const g = new Gate({ preroll: false });
  const f = frame(7);
  const [out] = g.process(f, 0.95);
  f.fill(0);
  expect(id(out)).toBe(7);
});
