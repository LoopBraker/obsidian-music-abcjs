import {ExternalTokenizer} from "@lezer/lr"

// @ts-ignore
import {
  InfoKey,
  KeyKey,
  VoiceKey,
  TimeSignatureKey
} from "./abc.grammar.terms"

const newline = 10, carriageReturn = 13, colon = 58, 
      upperV = 86, upperK = 75, upperM = 77;

function isLetter(code: number) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

export const lineStartTokens = new ExternalTokenizer((input, stack) => {
  // 1. Check context: Are we at the start of a line?
  let prev = input.peek(-1)
  // Allow if start of file (-1), newline, or if we are just after an open bracket for Inline headers e.g. [K:
  let isStartOfLine = (prev == -1 || prev == newline || prev == carriageReturn);
  let isInlineBracket = (prev == 91); // '['

  if (!isStartOfLine && !isInlineBracket) return;

  // 2. Check Pattern: Letter followed immediately by Colon (e.g., "A:")
  let char = input.peek(0)
  let next = input.peek(1)

  if (isLetter(char) && next === colon) {
    // Consume 2 chars (Letter + Colon)
    input.advance(2) 

    if (char === upperV) {
      input.acceptToken(VoiceKey)
    } else if (char === upperK) {
      input.acceptToken(KeyKey)
    } else if (char === upperM) {
      input.acceptToken(TimeSignatureKey)
    } else {
      input.acceptToken(InfoKey)
    }
  }
})