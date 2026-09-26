// Chip inputs (profile Skills, the create page's "+ add skill"): Backspace in
// an empty input removes the last chip, as in most tag editors.
//
// "Safely" means it never fires when the user is just editing text:
//   - only when the input is truly empty (not merely whitespace being typed);
//   - not while an IME composition is in progress (Backspace there edits the
//     composition, e.g. Hindi or Japanese input);
//   - not on auto-repeat, so holding Backspace to clear the text does not go
//     on to delete chip after chip;
//   - not with a modifier (Ctrl/Alt/Meta+Backspace are word/line deletes).

export type ChipKeyEvent = {
  key: string;
  repeat?: boolean;
  isComposing?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

/** Whether this keydown should remove the last chip. */
export function shouldRemoveLastChip(e: ChipKeyEvent, inputValue: string, chipCount: number): boolean {
  return (
    e.key === "Backspace" &&
    inputValue === "" &&
    chipCount > 0 &&
    !e.repeat &&
    !e.isComposing &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey
  );
}

/** The chips with the last one removed (a new array; the input is not mutated). */
export function withoutLastChip<T>(chips: readonly T[]): T[] {
  return chips.slice(0, -1);
}
