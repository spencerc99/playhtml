// ABOUTME: Tests bounded participant color loading across large event selections.
// ABOUTME: Verifies complete coverage, duplicate IDs, and explicit lookup failures.

import { describe, expect, it } from 'vitest';
import { loadParticipantColors } from '../lib/participantColors';

describe('participant colors', () => {
  it('keeps public-key queries small while loading every participant', async () => {
    const rows = Array.from({ length: 235 }, (_, i) => ({
      pid: `pk_${i.toString(16).padStart(130, '0')}`,
      cursor_color: `hsl(${i}, 70%, 50%)`,
    }));
    const batches: string[][] = [];
    const colors = await loadParticipantColors(
      [...rows.map(row => row.pid), rows[0].pid],
      async ids => {
        batches.push(ids);
        const query = new URLSearchParams({ select: 'pid,cursor_color', pid: `in.(${ids.join(',')})` });
        expect(new TextEncoder().encode(query.toString()).length).toBeLessThan(8000);
        return { data: rows.filter(row => ids.includes(row.pid)), error: null };
      },
    );
    expect(batches.map(batch => batch.length)).toEqual([50, 50, 50, 50, 35]);
    expect(colors).toEqual(new Map(rows.map(row => [row.pid, row.cursor_color])));
  });

  it('does not turn a failed lookup into missing colors', async () => {
    await expect(loadParticipantColors(['p'], async () => ({
      data: null, error: { message: 'URI too long' },
    }))).rejects.toThrow('Participant color lookup failed: URI too long');
  });

  it('distinguishes absent colors and participants from a failed query', async () => {
    const colors = await loadParticipantColors(['p', 'absent'], async () => ({
      data: [{ pid: 'p', cursor_color: null }], error: null,
    }));
    expect(colors.has('p')).toBe(true);
    expect(colors.get('p')).toBeNull();
    expect(colors.has('absent')).toBe(false);
  });
});
