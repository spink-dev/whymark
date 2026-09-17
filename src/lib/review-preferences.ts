export interface ReviewPreferences {
  version: 1;
  syncScroll: boolean;
  collapseNotes: boolean;
  compactRail: boolean;
}

export const DEFAULT_PREFERENCES: ReviewPreferences = {
  version: 1,
  syncScroll: true,
  collapseNotes: true,
  compactRail: true,
};
export const PREFERENCES_KEY = "whymark.preferences.v1";

export function parsePreferences(raw: string | null): ReviewPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1) return { ...DEFAULT_PREFERENCES };
    return {
      version: 1,
      syncScroll: typeof value.syncScroll === "boolean" ? value.syncScroll : true,
      collapseNotes: typeof value.collapseNotes === "boolean" ? value.collapseNotes : true,
      compactRail: typeof value.compactRail === "boolean" ? value.compactRail : true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
