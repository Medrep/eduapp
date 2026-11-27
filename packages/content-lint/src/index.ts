import { MAX_LESSON_BYTES } from "@moja-nauka/contracts";

// Only checks the shared size contract. File content and integrity need separate validation.
export function isSupportedLessonByteLength(byteLength: number): boolean {
  return Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= MAX_LESSON_BYTES;
}
