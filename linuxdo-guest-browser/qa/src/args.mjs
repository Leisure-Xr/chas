export function parseArguments(values) {
  const [command = 'help', ...rest] = values;
  const options = new Map();
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const equal = value.indexOf('=');
    const key = value.slice(2, equal === -1 ? undefined : equal);
    let optionValue = equal === -1 ? undefined : value.slice(equal + 1);
    if (optionValue === undefined && rest[index + 1] && !rest[index + 1].startsWith('--')) {
      optionValue = rest[index + 1];
      index += 1;
    }
    if (optionValue === undefined) optionValue = true;
    const existing = options.get(key) || [];
    existing.push(optionValue);
    options.set(key, existing);
  }
  return { command, options, positional };
}

export function option(options, key, fallback) {
  const values = options.get(key);
  return values?.at(-1) ?? fallback;
}

export function options(optionsMap, key) {
  return optionsMap.get(key) || [];
}

export function flag(optionsMap, key) {
  return optionsMap.has(key) && option(optionsMap, key) !== 'false';
}
