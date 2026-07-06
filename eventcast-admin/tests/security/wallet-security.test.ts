import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const walletSourcePath = fileURLToPath(new URL('../../src/app/components/Wallet.tsx', import.meta.url));
const walletSource = readFileSync(walletSourcePath, 'utf8');

describe('Wallet.tsx top-up security posture (source-level, no rendering)', () => {
  const forbiddenStrings = [
    '/api/billing/topup',
    'handleSimulateTopUp',
    'setTopUpAmount',
    'setTopUpSuccess',
    'setIsSimulating',
  ];

  it.each(forbiddenStrings)('does not contain %s', (needle) => {
    expect(walletSource).not.toContain(needle);
  });

  it('shows the temporary-unavailability message', () => {
    expect(walletSource).toContain(
      'Wallet top-ups are temporarily unavailable while we finish building secure payment verification.'
    );
  });

  it('keeps the visible top-up controls (preset amounts, custom input, submit button) disabled', () => {
    const bareDisabledCount = (walletSource.match(/\bdisabled\b(?!=)/g) ?? []).length;
    expect(bareDisabledCount).toBeGreaterThanOrEqual(3);
  });
});
