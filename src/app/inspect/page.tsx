import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { InspectClient } from "./inspect-client";

export const metadata = {
  title: "Paste a review — crev",
};

const SAMPLE = `---
crev: 1
title: Reject expired invite tokens
author: your-model (paste this anywhere)
scope: staged
summary: |
  Invite acceptance trusted any token that existed, so an invite from six
  months ago still worked. This adds an expiry check at the boundary.
checks:
  - cmd: npm test -- invites
    status: pass
---

@file src/invites/accept.ts modified +4 -1
@@ -18,7 +18,10 @@ export async function acceptInvite(token: string) {
   const invite = await db.invites.findByToken(token);
   if (!invite) throw new NotFound("invite");
-  return db.members.create({ orgId: invite.orgId, userId: invite.userId });
+  if (invite.expiresAt < new Date()) {
+    throw new Gone("invite expired");
+  }
+  return db.members.create({ orgId: invite.orgId, userId: invite.userId });
 }

@note +21..23 kind=security risk=high confidence=0.85
why: Invites were valid forever. An address that lost access to an org could
  still be joined by anyone holding an old link.
source: file:src/invites/create.ts:31 — expiresAt is already written on create
source: prompt:"invites should stop working after a week" — your words
verify: cmd \`npm test -- invites\` => pass (adds the expired-token case)
verify: manual "410 for a token dated last month" => pass
alt: soft-deleting expired rows in a cron — rejected, it hides the audit trail

\`Gone\` maps to HTTP 410 in the error middleware, so the client can tell
"expired" apart from "never existed".

@note +24 kind=assumption confidence=0.4
why: Server clock is trusted for the comparison.
source: inference — no clock-skew convention exists in this codebase yet
verify: none => unknown
question: should expiry be evaluated in the database instead, so replicas agree?
`;

export default function InspectPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label="All reviews"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-[15px] font-medium">Paste a review</h1>
          <p className="text-[12.5px] text-muted-foreground">
            Render any <code className="font-mono">.crev</code> document without saving it —
            useful for a review an agent just wrote into the chat.
          </p>
        </div>
      </header>
      <InspectClient sample={SAMPLE} />
    </div>
  );
}
