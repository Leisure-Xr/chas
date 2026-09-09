export function assertReleaseId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(value || ''))) {
    throw new Error('Release identifier must use 1-80 letters, numbers, dots, underscores, or hyphens');
  }
  return value;
}
