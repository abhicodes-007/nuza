import { ChangeSet, Text } from "@codemirror/state";

/** What the footer knows about the open document. */
export interface DocumentStats {
  words: number;
  characters: number;
  paragraphs: number;
  /** Caret position, 1-based, the way an editor reports it. */
  line: number;
  column: number;
}

export const EMPTY_DOCUMENT_STATS: DocumentStats = {
  words: 0,
  characters: 0,
  paragraphs: 0,
  line: 1,
  column: 1,
};

/** Words per minute for the reading estimate - the usual figure for prose. */
const READING_SPEED = 200;

export function readingMinutes(words: number) {
  return words === 0 ? 0 : Math.max(1, Math.round(words / READING_SPEED));
}

function isSpace(code: number) {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}

/**
 * Words and paragraphs in the document.
 *
 * Walks the text in the chunks CodeMirror already holds rather than joining it
 * into one string first, which on a long document would cost more than the
 * counting does. Still proportional to the document's length, so callers run it
 * when typing has stopped rather than on the keystroke itself.
 */
export function countDocument(doc: Text) {
  let words = 0;
  let paragraphs = 0;
  let inWord = false;
  let lineHasContent = false;
  let afterBlankLine = true;

  const iter = doc.iter();
  while (!iter.next().done) {
    if (iter.lineBreak) {
      if (!lineHasContent) afterBlankLine = true;
      lineHasContent = false;
      inWord = false;
      continue;
    }

    const chunk = iter.value;
    for (let i = 0; i < chunk.length; i++) {
      if (isSpace(chunk.charCodeAt(i))) {
        inWord = false;
        continue;
      }

      lineHasContent = true;
      if (afterBlankLine) {
        paragraphs++;
        afterBlankLine = false;
      }
      if (!inWord) {
        inWord = true;
        words++;
      }
    }
  }

  return { words, paragraphs, characters: doc.length };
}

/** Words and paragraphs, the part of the count that edits can change. */
export interface WordTally {
  words: number;
  paragraphs: number;
}

/** Past this many lines touched by one edit, counting afresh is no dearer. */
const RECOUNT_LIMIT = 5000;

function isBlank(text: string) {
  for (let i = 0; i < text.length; i++) if (!isSpace(text.charCodeAt(i))) return false;
  return true;
}

function wordsIn(text: string) {
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text.charCodeAt(i))) inWord = false;
    else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  return words;
}

/**
 * What lines `first` to `last` add to the count. A word never runs across a
 * line, and a paragraph is a line with something on it after a blank one -
 * so each line's share depends on nothing but itself and the line above.
 */
function tallyLines(doc: Text, first: number, last: number): WordTally {
  let words = 0;
  let paragraphs = 0;
  let previousBlank = first === 1 || isBlank(doc.line(first - 1).text);

  for (let number = first; number <= last; number++) {
    const text = doc.line(number).text;
    const blank = isBlank(text);
    words += wordsIn(text);
    if (!blank && previousBlank) paragraphs++;
    previousBlank = blank;
  }

  return { words, paragraphs };
}

/**
 * The count of `after`, from the count of `before` and the edit between them.
 *
 * Only the lines the edit touched are counted again, along with the line after
 * them, whose paragraph can start or stop with a blank line appearing above
 * it - that line is the same text either side of the edit. Everything else is
 * carried over. An edit touching thousands of lines is counted afresh.
 */
export function recount(before: Text, after: Text, changes: ChangeSet, tally: WordTally): WordTally {
  let fromA = Infinity;
  let toA = -1;
  let fromB = Infinity;
  let toB = -1;
  changes.iterChangedRanges((changeFromA, changeToA, changeFromB, changeToB) => {
    fromA = Math.min(fromA, changeFromA);
    toA = Math.max(toA, changeToA);
    fromB = Math.min(fromB, changeFromB);
    toB = Math.max(toB, changeToB);
  });
  if (toA < 0) return tally;

  const firstA = before.lineAt(fromA).number;
  const lastA = Math.min(before.lineAt(toA).number + 1, before.lines);
  const firstB = after.lineAt(fromB).number;
  const lastB = Math.min(after.lineAt(toB).number + 1, after.lines);

  if (lastA - firstA + (lastB - firstB) > RECOUNT_LIMIT) {
    const { words, paragraphs } = countDocument(after);
    return { words, paragraphs };
  }

  const removed = tallyLines(before, firstA, lastA);
  const added = tallyLines(after, firstB, lastB);
  return {
    words: tally.words - removed.words + added.words,
    paragraphs: tally.paragraphs - removed.paragraphs + added.paragraphs,
  };
}
