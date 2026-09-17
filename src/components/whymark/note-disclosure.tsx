"use client";

import { createContext, useContext } from "react";

export const NoteDisclosure = createContext<{ expanded: (id: string) => boolean; toggle: (id: string) => void }>({
  expanded: () => false,
  toggle: () => {},
});

export function useNoteDisclosure(id: string) {
  const state = useContext(NoteDisclosure);
  return { expanded: state.expanded(id), toggle: () => state.toggle(id) };
}
