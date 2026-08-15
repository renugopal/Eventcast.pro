/**
 * Phone-first Auth preparation helper (Analytics + Provider operational/
 * support/auth delivery package, Baseline V2.1 AUTH-001/AUTH-008). Pure
 * normalization only — no OTP send/verify logic lives here. Supabase Auth
 * remains the sole OTP/session/verification authority; this module never
 * creates a second one.
 */

const INDIA_COUNTRY_CODE = "91";

/**
 * Normalizes a provider-entered Indian mobile number into a stable E.164
 * string (e.g. "+919876543210"), or returns null if the input cannot be
 * confidently normalized. Accepts a bare 10-digit number, a leading trunk
 * "0", a leading "91" country code, or an already-E.164 "+91" value — all
 * other shapes are rejected rather than guessed at.
 */
export function normalizeIndianMobileToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digitsOnly = raw.replace(/[^\d]/g, "");

  let national = digitsOnly;
  if (national.length === 11 && national.startsWith("0")) {
    national = national.slice(1);
  }
  if (national.length === 12 && national.startsWith(INDIA_COUNTRY_CODE)) {
    national = national.slice(2);
  }

  if (!/^[6-9]\d{9}$/.test(national)) return null;
  return `+${INDIA_COUNTRY_CODE}${national}`;
}

/** True only for a value already in the exact normalized E.164 shape. */
export function isValidE164IndianMobile(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\+91[6-9]\d{9}$/.test(value);
}
