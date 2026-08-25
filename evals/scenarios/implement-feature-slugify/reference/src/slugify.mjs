export function slugify(input, options = {}) {
  if (typeof input !== 'string') {
    throw new TypeError('input must be a string');
  }
  const maxLength = options.maxLength ?? 64;
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new TypeError('maxLength must be a positive integer');
  }
  return input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}
