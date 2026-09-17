"use client";

import { Settings } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DEFAULT_PREFERENCES, type ReviewPreferences } from "@/lib/review-preferences";

export function ReviewSettings({ value, onChange }: {
  value: ReviewPreferences;
  onChange: (value: ReviewPreferences) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger aria-label="Review settings" className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5">
        <Settings className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Review settings</DialogTitle>
        <DialogDescription>Preferences for this browser. Code decisions are kept separate.</DialogDescription>
        {([
          ["syncScroll", "Synchronize horizontal scrolling"],
          ["collapseNotes", "Collapse comments by default"],
          ["compactRail", "Compact layout without blank code rows"],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
            {label}
          </label>
        ))}
        <button type="button" className="justify-self-start rounded border px-3 py-1.5" onClick={() => onChange({ ...DEFAULT_PREFERENCES })}>
          Reset defaults
        </button>
      </DialogContent>
    </Dialog>
  );
}
