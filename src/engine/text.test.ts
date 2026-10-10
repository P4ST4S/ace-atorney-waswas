import { describe, expect, it } from 'vitest';
import { frenchTypography, parseMarkup, plainText } from './text.ts';
import { ContentError } from './types.ts';

const NNBSP = '\u202F';
const NBSP = '\u00A0';

describe('frenchTypography', () => {
  it('uses a narrow no-break space before ! ? ;', () => {
    expect(frenchTypography('Objection ! Vraiment ? Oui ; non')).toBe(`Objection${NNBSP}! Vraiment${NNBSP}? Oui${NNBSP}; non`);
  });
  it('inserts the missing space once before a ?! sequence', () => {
    expect(frenchTypography('Quoi?!')).toBe(`Quoi${NNBSP}?!`);
  });
  it('uses a no-break space before a spaced colon but keeps times intact', () => {
    expect(frenchTypography('Note : 23:12')).toBe(`Note${NBSP}: 23:12`);
  });
  it('puts no-break spaces inside guillemets', () => {
    expect(frenchTypography('« Vers 21 h »')).toBe(`«${NBSP}Vers 21 h${NBSP}»`);
  });
});

describe('parseMarkup', () => {
  it('parses colours, pauses, speed and inline effects', () => {
    expect(parseMarkup('Il est {red}coupable{/}.{p:300}{s:0.5}Enfin{shake}{flash}{sfx:sfx.gavel}')).toEqual([
      { t: 'text', text: 'Il est ', color: 'white' },
      { t: 'text', text: 'coupable', color: 'red' },
      { t: 'text', text: '.', color: 'white' },
      { t: 'pause', ms: 300 },
      { t: 'speed', factor: 0.5 },
      { t: 'text', text: 'Enfin', color: 'white' },
      { t: 'shake' },
      { t: 'flash' },
      { t: 'sfx', sound: 'sfx.gavel' },
    ]);
  });

  it('normalises typography outside {raw} only', () => {
    const tokens = parseMarkup('Il a écrit : {raw}« ok?? » à 23:12 !{/raw} Quoi ?');
    expect(plainText(tokens)).toBe(`Il a écrit${NBSP}: « ok?? » à 23:12 ! Quoi${NNBSP}?`);
  });

  it('keeps tags literal inside {raw} and supports escaped braces', () => {
    expect(plainText(parseMarkup('{raw}{red}{/raw} {{x}}'))).toBe('{red} {x}');
  });

  it.each(['{bold}x', '{p:abc}', '{red', 'a } b', '{raw}x'])('rejects invalid markup %s', (bad) => {
    expect(() => parseMarkup(bad)).toThrow(ContentError);
  });
});
