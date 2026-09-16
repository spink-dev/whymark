import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { SITE_HOST, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use — whymark",
  description: `Terms for using the whymark viewer at ${SITE_HOST}.`,
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="16 September 2026">
      <p>
        These terms govern your use of the whymark viewer at{" "}
        <a href={SITE_URL}>{SITE_HOST}</a> (the “service”), operated in connection
        with the open-source whymark project. By using the service you agree to
        them. If you do not agree, do not use it.
      </p>

      <LegalSection title="1. What the service is">
        <p>
          The service is a browser-based viewer for <code>.whymark</code> files. It
          lets you drop or paste a review and read the diff with its annotations.
          It is offered as-is, without an account, and without a paid plan.
        </p>
      </LegalSection>

      <LegalSection title="2. Your files stay on your device">
        <p>
          Opening a file processes it in your browser. The contents of a review
          you drop or paste are not uploaded to our servers, not written to a
          database, and not stored by us. A short history of files you opened is
          kept only in this browser (IndexedDB on this origin). You can clear that
          history, and the app cache, from the home page at any time.
        </p>
        <p>
          Requesting the website itself still produces ordinary web logs on the
          host (Vercel): timestamp, IP address, user-agent, and the URL of the
          page or asset. Vercel Web Analytics also records page views. Neither
          includes the text of a file you opened in the viewer.
        </p>
      </LegalSection>

      <LegalSection title="3. Your responsibilities">
        <p>
          You are responsible for the files you open and for how you use what you
          read. Do not open material you are not allowed to possess or to display
          on the machine you are using. Do not use the service to break the law,
          to infringe other people’s rights, or to probe, overload, or disrupt the
          site.
        </p>
        <p>
          A <code>.whymark</code> file can contain source code, secrets, or personal
          data. Because processing is local, we never see it — but anything in the
          file is visible to anyone who can use this browser profile. Treat the
          machine accordingly.
        </p>
      </LegalSection>

      <LegalSection title="4. The software">
        <p>
          The viewer and the whymark format tools are published under the MIT
          License, with the AI-Led Development Acknowledgement in the repository
          LICENSE. These terms do not take away the permissions MIT gives you to
          run, copy, or modify the software yourself.
        </p>
      </LegalSection>

      <LegalSection title="5. No warranty">
        <p>
          The service is provided “as is”, without warranty of any kind, express
          or implied, including merchantability, fitness for a particular purpose,
          and non-infringement. We do not warrant that the viewer is accurate,
          available, or free of defects, or that a review rendered here matches
          the files on any other machine.
        </p>
      </LegalSection>

      <LegalSection title="6. Limitation of liability">
        <p>
          To the fullest extent permitted by law, we are not liable for any
          indirect, incidental, special, consequential, or punitive damages, or
          for any loss of data, profits, or reputation, arising from your use of
          the service. Writing decisions back to a working tree is disabled on
          this hosted site; it is only available when you run the viewer against
          your own checkout.
        </p>
      </LegalSection>

      <LegalSection title="7. Changes and availability">
        <p>
          We may change these terms, or suspend or stop the hosted viewer, at any
          time. The current terms are always at {SITE_HOST}/terms. Continued use
          after a change is acceptance of the new terms.
        </p>
      </LegalSection>

      <LegalSection title="8. Contact">
        <p>
          The project lives at{" "}
          <a href="https://github.com/spink-dev/whymark">github.com/spink-dev/whymark</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
