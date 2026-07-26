const UNIT_WORDS = [
  'cloves?',
  'cups?',
  'tsp',
  'tbsp',
  'teaspoons?',
  'tablespoons?',
  'ounces?',
  'oz',
  'pounds?',
  'lbs?',
  'grams?',
  'g',
  'kg',
  'pinch(?:es)?',
  'dash(?:es)?',
  'slices?',
  'sprigs?',
  'stalks?',
  'cans?',
  'bunch(?:es)?',
  'sticks?',
  'heads?',
];

const LEADING_QUANTITY_RE = new RegExp(`^\\s*(?:[\\d¼½¾⅓⅔./]+\\s*)?(?:${UNIT_WORDS.join('|')})\\s+`, 'i');
const LEADING_BARE_NUMBER_RE = /^\s*[\d¼½¾⅓⅔./]+\s+/;

export function normalizeIngredient(item: string): string {
  let s = item.toLowerCase().trim();

  const commaIndex = s.indexOf(',');
  if (commaIndex !== -1) s = s.slice(0, commaIndex).trim();

  s = s.replace(LEADING_QUANTITY_RE, '').trim();
  s = s.replace(LEADING_BARE_NUMBER_RE, '').trim();

  const words = s.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (last && /s$/.test(last) && !/ss$/.test(last) && !/[aeiou]sses$/.test(last)) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join(' ');
}
