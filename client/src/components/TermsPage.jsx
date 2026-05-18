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

export default function TermsPage() {
  useDocumentScroll();

  return (
    <main style={styles.page}>
      <section style={styles.content}>
        <a href="/" style={styles.brand}>Hire Near</a>
        <p style={styles.kicker}>Terms of Service</p>
        <h1 style={styles.title}>Terms for using Hire Near</h1>
        <p style={styles.updated}>Last updated: May 18, 2026</p>

        <section style={styles.section}>
          <h2 style={styles.heading}>What Hire Near does</h2>
          <p style={styles.copy}>
            Hire Near helps job seekers discover nearby businesses, inspect public hiring signals, and decide which businesses they may want to contact. We may use AI systems, including Anthropic Claude, to summarize public evidence and rank fit.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>No hiring decision or job guarantee</h2>
          <p style={styles.copy}>
            Hire Near does not make hiring, employment, credit, housing, insurance, legal, medical, or other high-impact decisions. Match scores and reports are informational only. Employers and job seekers remain responsible for their own decisions.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Job seeker responsibilities</h2>
          <p style={styles.copy}>
            You are responsible for the resume text, email address, work preferences, and other information you provide. Do not submit information you do not have permission to share. Do not use Hire Near to harass, spam, misrepresent yourself, or contact businesses unlawfully.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Business communications</h2>
          <p style={styles.copy}>
            If you ask Hire Near to notify businesses, you authorize us to send your interest to selected businesses with public contact information. Businesses may receive a match link and may reply to Hire Near. We do not guarantee that any business will respond or that any role is available.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Public website inspection only</h2>
          <p style={styles.copy}>
            Hire Near checks public business websites and public search results. We do not submit forms, solve CAPTCHAs, access authenticated pages, bypass technical restrictions, or apply to jobs on your behalf.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>AI limitations</h2>
          <p style={styles.copy}>
            AI outputs can be incomplete, inaccurate, or outdated. You should review evidence links and use your own judgment before contacting a business, relying on a match score, or making any employment-related decision.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Acceptable use</h2>
          <p style={styles.copy}>
            You may not use Hire Near to break the law, violate another party's rights, send abusive or deceptive messages, scrape at abusive volume, reverse engineer the service, or interfere with service operations.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Service availability</h2>
          <p style={styles.copy}>
            Hire Near is an early service and may change, pause, or stop features at any time. We may limit usage to control cost, abuse, or reliability issues.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Age eligibility</h2>
          <p style={styles.copy}>
            You must be at least 18 years old to use Hire Near.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Limitation of liability</h2>
          <p style={styles.copy}>
            Hire Near is not liable for employment outcomes, damages arising from AI inaccuracies, business responses or lack thereof, or any indirect, incidental, or consequential damages.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Governing law</h2>
          <p style={styles.copy}>
            These terms are governed by the laws of the State of Utah, without regard to its conflict of law principles.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Contact</h2>
          <p style={styles.copy}>
            Questions about these terms can be sent to <a href={`mailto:${CONTACT_EMAIL}`} style={styles.inlineLink}>{CONTACT_EMAIL}</a>.
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
