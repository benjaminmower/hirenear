import { useEffect } from 'react';
import PublicFooter from './PublicFooter.jsx';

const CONTACT_EMAIL = 'hello@hirenear.app';

function useDocumentScroll() {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootHeight = document.getElementById('root')?.style.height || '';
    const root = document.getElementById('root');

    document.body.style.overflow = 'auto';
    if (root) root.style.height = 'auto';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (root) root.style.height = previousRootHeight;
    };
  }, []);
}

export default function PrivacyPage() {
  useDocumentScroll();

  return (
    <main style={styles.page}>
      <section style={styles.content}>
        <a href="/" style={styles.brand}>Hire Near</a>
        <p style={styles.kicker}>Privacy Policy</p>
        <h1 style={styles.title}>How Hire Near handles your information</h1>
        <p style={styles.updated}>Last updated: May 18, 2026</p>

        <section style={styles.section}>
          <h2 style={styles.heading}>What we collect</h2>
          <p style={styles.copy}>
            Hire Near collects information you provide when using the scout workflow, including resume text, selected work lanes, avoid terms, dropped-pin location, email address if you ask us to notify businesses, and basic usage data needed to operate the service.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>How we use it</h2>
          <p style={styles.copy}>
            We use this information to find nearby businesses, inspect public websites for hiring signals, rank fit, prepare scout reports, send candidate interest to selected businesses, and maintain service reliability and abuse limits.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Third-party services</h2>
          <p style={styles.copy}>
            Hire Near uses infrastructure and APIs including Google Cloud, Mapbox, Google Places, Anthropic Claude, Resend, and database hosting. Resume text may be sent to this server and Anthropic Claude for matching. Anthropic does not use API inputs to train models. Business websites are checked using public pages only.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Business notifications</h2>
          <p style={styles.copy}>
            If you ask us to notify businesses, we may send your interest to businesses that appear to be strong fits and have public contact information. Those businesses may receive a match link and may reply to Hire Near.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Business signups</h2>
          <p style={styles.copy}>
            If you sign up your business through Hire Near, we collect your business name, your name, your email address, city and state, the kinds of work you typically hire for, your current hiring channel, and rough hiring volume. We use this to contact you about Hire Near, send you qualified candidate introductions, and improve the service. We do not sell business contact information.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>What we do not do</h2>
          <p style={styles.copy}>
            Hire Near does not submit applications, fill out forms, solve CAPTCHAs, access private or authenticated pages, or crawl off-domain content for a business. We do not sell resume text.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Retention</h2>
          <p style={styles.copy}>
            Scout runs expire and are deleted within 30 days. You can delete a scout run from the product when it is available in your current browser session. Seeker email addresses are retained only as long as needed to deliver match notifications to businesses and are deleted after the run expires.
          </p>
          <p style={{ ...styles.copy, marginTop: 12 }}>
            Separately, Hire Near keeps a longitudinal record of public business hiring signals (such as "careers page detected" or "contact email visible") for up to 180 days to improve match quality over time. This record contains only public business information - no resume text, no seeker identity, and no record of contact between specific seekers and specific businesses.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Contact</h2>
          <p style={styles.copy}>
            Questions or deletion requests can be sent to <a href={`mailto:${CONTACT_EMAIL}`} style={styles.inlineLink}>{CONTACT_EMAIL}</a>.
          </p>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}

const font = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const styles = {
  page: {
    minHeight: '100dvh',
    background: '#f7f8f5',
    color: '#182033',
    fontFamily: font,
  },
  content: {
    width: 'min(calc(100% - 28px), 820px)',
    margin: '0 auto',
    padding: '34px 0 42px',
  },
  brand: {
    display: 'inline-block',
    color: '#182033',
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 22,
    fontWeight: 800,
    textDecoration: 'none',
    marginBottom: 34,
  },
  kicker: {
    color: '#8b8173',
    fontSize: 12,
    fontWeight: 900,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 46,
    lineHeight: 1.05,
    fontWeight: 800,
    marginBottom: 12,
  },
  updated: {
    color: '#6f5f4c',
    fontSize: 14,
    marginBottom: 28,
  },
  section: {
    borderTop: '1px solid #d9d3c9',
    padding: '22px 0',
  },
  heading: {
    fontSize: 18,
    marginBottom: 8,
  },
  copy: {
    color: '#4d5665',
    fontSize: 15,
    lineHeight: 1.7,
  },
  inlineLink: {
    color: '#255e91',
    fontWeight: 800,
  },
};
