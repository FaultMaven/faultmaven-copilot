import { describe, it, expect, vi, afterEach } from 'vitest';
import { IdMappingManager } from '../../lib/optimistic/IdMappingManager';

describe('IdMappingManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps optimistic ids to their real ids', () => {
    const m = new IdMappingManager();
    m.addMapping('opt_case_1', 'real_1');

    expect(m.getRealId('opt_case_1')).toBe('real_1');
    expect(m.getRealId('opt_case_unknown')).toBeUndefined();
  });

  it('rejects a non-optimistic id (guards against mapping a real id by mistake)', () => {
    const m = new IdMappingManager();
    expect(() => m.addMapping('real_1', 'real_2')).toThrow(/Not an optimistic id/);
  });

  it('evicts mappings older than the max age (prevents unbounded growth)', () => {
    vi.useFakeTimers();
    const m = new IdMappingManager();
    m.addMapping('opt_case_1', 'real_1');
    expect(m.getRealId('opt_case_1')).toBe('real_1');

    vi.advanceTimersByTime(5000);
    m.cleanup(1000); // evict anything older than 1s

    expect(m.getRealId('opt_case_1')).toBeUndefined();
  });

  it('runs cleanup automatically on the elastic timer once mappings exist', () => {
    vi.useFakeTimers();
    // Short cleanup interval; default 1h max age, so advance past both.
    const m = new IdMappingManager(1000);
    m.addMapping('opt_msg_1', 'real_msg_1');

    vi.advanceTimersByTime(3_600_000 + 1000);

    expect(m.getRealId('opt_msg_1')).toBeUndefined();
  });
});
