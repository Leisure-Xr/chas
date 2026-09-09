export function compareVersions(left, right) {
  const a = numericParts(left);
  const b = numericParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function latestVersion(values) {
  return [...values].sort((left, right) => compareVersions(right, left))[0];
}

export function matchesLine(version, line) {
  return line === 'latest' || version === line || version.startsWith(`${line}.`);
}

function numericParts(value) {
  return String(value).match(/\d+/g)?.map(Number) || [0];
}
