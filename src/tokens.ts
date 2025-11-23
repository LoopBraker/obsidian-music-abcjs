import {ExternalTokenizer} from "@lezer/lr"

// @ts-ignore
import {InfoKey} from "./abc.grammar.terms"

const newline = 10, carriageReturn = 13, colon = 58, 
      upperV = 86, upperK = 75;

function isLetter(code: number) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

export const lineStartTokens = new ExternalTokenizer((input, stack) => {
  // 1. Check context: Are we at the start of a line?
  let prev = input.peek(-1)
  if (prev != -1 && prev != newline && prev != carriageReturn) {
    // We are in the middle of a line. 
    // Surrender control to the internal grammar.
    return; 
  }

  // 2. Check Pattern: Letter followed immediately by Colon (e.g., "A:")
  let char = input.peek(0)
  let next = input.peek(1)

  if (isLetter(char) && next === colon) {
    // 3. Exceptions: 
    // V: and K: have their own specific tokens in the grammar.
    if (char === upperV || char === upperK) return;

    input.acceptToken(InfoKey, 2) // Consume 2 chars
  }
})