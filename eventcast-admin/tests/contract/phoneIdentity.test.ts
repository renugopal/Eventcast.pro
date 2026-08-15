import { describe, expect, it } from 'vitest';
import { normalizeIndianMobileToE164, isValidE164IndianMobile } from '@/lib/phoneIdentity';

describe('normalizeIndianMobileToE164', () => {
  it('normalizes a bare 10-digit number', () => {
    expect(normalizeIndianMobileToE164('9876543210')).toBe('+919876543210');
  });

  it('normalizes a number with a leading trunk 0', () => {
    expect(normalizeIndianMobileToE164('09876543210')).toBe('+919876543210');
  });

  it('normalizes a number with a leading 91 country code', () => {
    expect(normalizeIndianMobileToE164('919876543210')).toBe('+919876543210');
  });

  it('normalizes an already-E.164 value', () => {
    expect(normalizeIndianMobileToE164('+919876543210')).toBe('+919876543210');
  });

  it('normalizes a number with spaces/dashes', () => {
    expect(normalizeIndianMobileToE164('+91 98765-43210')).toBe('+919876543210');
  });

  it('rejects a number not starting with 6-9', () => {
    expect(normalizeIndianMobileToE164('5876543210')).toBeNull();
  });

  it('rejects a too-short number', () => {
    expect(normalizeIndianMobileToE164('98765')).toBeNull();
  });

  it('rejects a too-long number', () => {
    expect(normalizeIndianMobileToE164('98765432101234')).toBeNull();
  });

  it('rejects empty/null/undefined input', () => {
    expect(normalizeIndianMobileToE164('')).toBeNull();
    expect(normalizeIndianMobileToE164(null)).toBeNull();
    expect(normalizeIndianMobileToE164(undefined)).toBeNull();
  });

  it('never fabricates a value for garbage input', () => {
    expect(normalizeIndianMobileToE164('not a phone number')).toBeNull();
  });
});

describe('isValidE164IndianMobile', () => {
  it('accepts a correctly normalized value', () => {
    expect(isValidE164IndianMobile('+919876543210')).toBe(true);
  });

  it('rejects an unnormalized value', () => {
    expect(isValidE164IndianMobile('9876543210')).toBe(false);
  });

  it('rejects null/empty', () => {
    expect(isValidE164IndianMobile(null)).toBe(false);
    expect(isValidE164IndianMobile('')).toBe(false);
  });
});
