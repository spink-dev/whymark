import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { SITE_HOST, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy — whymark",
  description: `How the hosted viewer at ${SITE_HOST} handles data. Reviews are not uploaded.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="16 September 2026">
      <p>
        This page describes what happens to data when you use the hosted viewer
        at <a href={SITE_URL}>{SITE_HOST}</a>. It is meant to be complete, not
        reassuring.
      </p>

      <LegalSection title="We do not collect the reviews you open">
        <p>
          A file you drop, paste, or reopen from history is parsed, highlighted,
          and laid out in your browser. It is not posted to an API, not written
          to object storage, and not kept in a server-side database. There is no
          account and no cookie that identifies you across visits for that
          purpose.
        </p>
      </LegalSection>

      <LegalSection title="What stays on your device">
        <p>
          If rendering succeeds, a copy of that file is stored in IndexedDB under
          this origin, so you can reopen it later. Up to 25 entries are kept.
          That copy never leaves the browser unless you copy it out yourself.
          Clearing “history” or “app cache” on the home page deletes it. Closing
          the tab does not. Another profile, device, or browser will not see it.
        </p>
      </LegalSection>

      <LegalSection title="What the host can see">
        <p>
          The site is served by Vercel. Fetching a page or a static asset creates
          a request log: time, IP address, user-agent, referrer if the browser
          sends one, and the path (<code>/</code>, <code>/terms</code>, script
          URLs, and so on). Those logs are Vercel’s operational logs. They do not
          contain the body of a <code>.whymark</code> file you opened, because
          that body is not sent.
        </p>
        <p>
          We do not run a separate analytics product, ad network, or third-party
          tracker on this site.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          The viewer does not set an identification cookie. The host or the
          browser may store strictly technical items (for example cache entries).
          You can remove them with “clear app cache” on the home page, or with
          your browser’s site-data controls.
        </p>
      </LegalSection>

      <LegalSection title="Shipped examples">
        <p>
          Reviews that ship in the public repository (the “shipped examples” on
          the home page) are part of the website build. They are not your data.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          The service is not directed at children under 16, and we do not
          knowingly collect personal data from them.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If this notice changes, the date at the top of the page will change.
          The current version is always at {SITE_HOST}/privacy.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
