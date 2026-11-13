import { describe, expect, it } from 'vitest';
import { getUpdateStatus, installUpdate, isNewer } from '../src/server/update.js';

describe('Programm-Update', () => {
  it('vergleicht Versionsnummern', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('2.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.9', '1.0.0')).toBe(false);
  });
  it('ist außerhalb der gepackten Version abgeschaltet', async () => {
    expect(getUpdateStatus().supported).toBe(false);
    await expect(installUpdate()).rejects.toMatchObject({ code: 'update_unsupported' });
  });
});
