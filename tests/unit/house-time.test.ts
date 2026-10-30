// R-12 (D-84): zone display and form input are Intl arithmetic; storage stays UTC. The DST cases are the ones that bite.
import { describe, expect, it } from 'vitest';
import { fromLocalInput, inZone, isTimeZone, toLocalInput } from '@/auction/house-time';

describe('house time (R-12)', () => {
  it('names the zone on every printed time, UTC included', () => {
    const t = new Date('2031-01-01T17:00:00Z');
    expect(inZone(t, 'UTC')).toBe('2031-01-01 17:00 UTC');
    expect(inZone(t, 'America/New_York')).toBe('2031-01-01 12:00 EST');
    expect(inZone(new Date('2031-07-01T16:00:00Z'), 'America/New_York')).toBe('2031-07-01 12:00 EDT');
    expect(inZone(t, 'Asia/Kolkata')).toBe('2031-01-01 22:30 GMT+5:30');
    expect(inZone(new Date('2031-01-01T00:30:00Z'), 'UTC')).toBe('2031-01-01 00:30 UTC'); // h23: midnight is 00, never 24
  });
  it('reads a typed wall-clock time in the zone, winter and summer, and round-trips', () => {
    expect(fromLocalInput('2031-01-01T12:00', 'America/New_York')).toEqual(new Date('2031-01-01T17:00:00Z'));
    expect(fromLocalInput('2031-07-01T12:00', 'America/New_York')).toEqual(new Date('2031-07-01T16:00:00Z'));
    expect(fromLocalInput('2031-01-01T22:30', 'Asia/Kolkata')).toEqual(new Date('2031-01-01T17:00:00Z'));
    expect(fromLocalInput('2031-01-01T17:00', 'UTC')).toEqual(new Date('2031-01-01T17:00:00Z'));
    for (const [local, tz] of [['2031-03-09T01:59', 'America/New_York'], ['2031-11-02T03:00', 'America/New_York'], ['2030-12-31T23:59', 'Pacific/Auckland']] as const) expect(toLocalInput(fromLocalInput(local, tz)!, tz)).toBe(local);
  });
  it('DST edges: a spring gap reads forward, a fall overlap takes the first instant; neither throws', () => {
    expect(fromLocalInput('2031-03-09T02:30', 'America/New_York')).toEqual(new Date('2031-03-09T07:30:00Z')); // 02:30 does not exist; read as EST = 03:30 EDT
    expect(fromLocalInput('2031-11-02T01:30', 'America/New_York')).toEqual(new Date('2031-11-02T05:30:00Z')); // 01:30 happens twice; EDT, the first
  });
  it('refuses what it cannot read', () => {
    expect(fromLocalInput('2031-01-01 12:00', 'UTC')).toBeNull();
    expect(fromLocalInput('', 'UTC')).toBeNull();
    expect(isTimeZone('America/New_York')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});
