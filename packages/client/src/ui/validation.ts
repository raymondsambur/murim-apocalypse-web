/**
 * Client-side validation mirroring the server rules. Each validator returns an i18n key, or null when valid.
 * Username: 3-20 of [A-Za-z0-9_]. Password: 8-72 characters. Character name: MIN..MAX_NAME_LENGTH letters,
 * single spaces, apostrophes and hyphens, starting and ending with a letter.
 */
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from '@murim/shared';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export function validateUsername(u: string): string | null {
  if (!u) return 'val.username.required';
  if (u.length < USERNAME_MIN) return 'val.username.short';
  if (u.length > USERNAME_MAX) return 'val.username.long';
  if (!/^[A-Za-z0-9_]+$/.test(u)) return 'val.username.chars';
  return null;
}

export function validatePassword(p: string): string | null {
  if (!p) return 'val.password.required';
  if (p.length < PASSWORD_MIN) return 'val.password.short';
  if (p.length > PASSWORD_MAX) return 'val.password.long';
  return null;
}

export function validatePasswordConfirm(p: string, confirm: string): string | null {
  if (!confirm) return 'val.confirm.required';
  return p === confirm ? null : 'val.confirm.mismatch';
}

/** Trim and collapse inner whitespace, as the name will be stored. */
export function normalizeCharName(n: string): string {
  return n.trim().replace(/\s+/g, ' ');
}

export function validateCharName(raw: string): string | null {
  const n = normalizeCharName(raw);
  if (!n) return 'val.name.required';
  if (n.length < MIN_NAME_LENGTH) return 'val.name.short';
  if (n.length > MAX_NAME_LENGTH) return 'val.name.long';
  if (!/^[A-Za-z][A-Za-z' -]*[A-Za-z]$/.test(n)) return 'val.name.chars';
  if (/[' -]{2,}/.test(n)) return 'val.name.chars';
  return null;
}

/** 0..4 rough strength score for the password meter. */
export function passwordStrength(p: string): number {
  if (p.length < PASSWORD_MIN) return 0;
  let score = 1;
  if (p.length >= 12) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;
  else if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) score += 0.5;
  return Math.min(4, Math.floor(score));
}
