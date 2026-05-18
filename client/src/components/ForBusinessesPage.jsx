import { useEffect } from 'react';
import PublicFooter from './PublicFooter.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

const CONTACT_EMAIL = 'hello@hirenear.app';

function Brand() {
  return (
    <a href="/" style={styles.brand}>
      <span style={styles.logoMark} />
      <span style={styles.logoStack}>
        <span style={styles.logoText}>Hire Near</span>
        <span style={styles.logoTagline}>Recruiting intelligence</span>
      </span>
    </a>
  );
}

export default function ForBusinessesPage() {
  const isMobile = useMediaQuery('(max-width: 760px)');

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

  return (
    <main style={styles.page}>
      <section style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        <nav style={styles.nav}>
          <Brand />
          <a href={`mailto:${CONTACT_EMAIL}`} style={styles.navButton}>Talk to us</a>
        </nav>

        <div style={{ ...styles.heroCopy, ...(isMobile ? styles.heroCopyMobile : {}) }}>
          <p style={styles.kicker}>For local businesses</p>
          <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
            Stop paying $45 per Craigslist post for crickets or the kitchen sink.
          </h1>
          <p style={styles.lede}>
            Hire Near delivers a constant stream of qualified local candidates to your inbox - people who already reviewed your business and asked to talk. $50/month, cancel anytime.
          </p>
          <div style={styles.actions}>
            <a href="/for-businesses/signup" style={styles.primaryButton}>
              Become a design partner
            </a>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Hire Near for my business`} style={styles.secondaryButton}>
              Talk to us
            </a>
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <p style={styles.kicker}>What you get</p>
          <h2 style={styles.sectionTitle}>A better signal than another job ad.</h2>
        </div>
        <div style={{ ...styles.offerGrid, ...(isMobile ? styles.offerGridMobile : {}) }}>
          <div style={styles.offerCard}>
            <h3 style={styles.offerTitle}>Qualified, not infinite.</h3>
            <p style={styles.offerText}>Only candidates scoring 80%+ fit for your business reach you. No kitchen sink.</p>
          </div>
          <div style={styles.offerCard}>
            <h3 style={styles.offerTitle}>Their idea, not ours.</h3>
            <p style={styles.offerText}>Candidates pick you. They reviewed your business and asked to be introduced.</p>
          </div>
          <div style={styles.offerCard}>
            <h3 style={styles.offerTitle}>Local, not remote.</h3>
            <p style={styles.offerText}>Every candidate is already nearby and ready for in-person work.</p>
          </div>
        </div>

        <div style={{ ...styles.proofGrid, ...(isMobile ? styles.proofGridMobile : {}) }}>
          <div style={styles.panel}>
            <div style={styles.panelLabel}>What employers receive</div>
            <div style={styles.leadCard}>
              <div style={styles.score}>88% match</div>
              <div style={styles.businessName}>Candidate interest</div>
              <p style={styles.cardText}>
                A local candidate is interested in your company and wants to know whether you are hiring.
              </p>
              <div style={styles.signal}>Office coordination experience</div>
              <div style={styles.signal}>Customer support background</div>
              <div style={styles.signal}>Ready for nearby work</div>
            </div>
          </div>
          <div style={styles.proofCopy}>
            <h3 style={styles.proofTitle}>Warm introductions, not cold applicant floods.</h3>
            <p style={styles.proofText}>
              Hire Near starts from a real candidate's resume and neighborhood. We inspect public business signals, score fit, and only send the strongest matches when the candidate asks to be introduced.
            </p>
          </div>
        </div>
      </section>

      <section style={{ ...styles.pricingBand, ...(isMobile ? styles.pricingBandMobile : {}) }}>
        <div>
          <div style={styles.price}>$50/month</div>
          <p style={styles.priceText}>Flat. Cancel anytime. First 10 design partners get 3 months free.</p>
        </div>
        <a href="/for-businesses/signup" style={styles.primaryButton}>Become a design partner</a>
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
  hero: {
    minHeight: '64dvh',
    padding: '24px 28px 46px',
    borderBottom: '1px solid #d9d3c9',
    display: 'flex',
    flexDirection: 'column',
    gap: 72,
  },
  heroMobile: {
    minHeight: 'auto',
    padding: '18px 14px 34px',
    gap: 42,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    color: '#182033',
    textDecoration: 'none',
  },
  logoMark: {
    width: 22,
    height: 22,
    border: '2px solid #182033',
    borderRadius: '50%',
    boxShadow: 'inset 0 0 0 5px #ffffff, inset 0 0 0 7px #b56d2a',
    background: '#182033',
    display: 'inline-block',
  },
  logoStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  logoText: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1,
  },
  logoTagline: {
    fontSize: 10,
    fontWeight: 800,
    color: '#8b8173',
    textTransform: 'uppercase',
  },
  navButton: {
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 800,
    textDecoration: 'none',
  },
  heroCopy: {
    width: 'min(100%, 1040px)',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  heroCopyMobile: {
    gap: 16,
  },
  kicker: {
    color: '#8b8173',
    fontSize: 12,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 62,
    lineHeight: 1.02,
    fontWeight: 800,
    maxWidth: 920,
  },
  titleMobile: {
    fontSize: 38,
  },
  lede: {
    color: '#4d5665',
    fontSize: 18,
    lineHeight: 1.65,
    maxWidth: 760,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 6,
    background: '#182033',
    color: '#ffffff',
    padding: '13px 16px',
    fontSize: 14,
    fontWeight: 800,
    textDecoration: 'none',
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: '13px 16px',
    fontSize: 14,
    fontWeight: 800,
    textDecoration: 'none',
  },
  section: {
    width: 'min(calc(100% - 28px), 1120px)',
    margin: '0 auto',
    padding: '38px 0 34px',
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 34,
    lineHeight: 1.1,
    marginTop: 6,
  },
  offerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 14,
    marginBottom: 24,
  },
  offerGridMobile: {
    gridTemplateColumns: '1fr',
  },
  offerCard: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    padding: 18,
  },
  offerTitle: {
    fontSize: 17,
    lineHeight: 1.3,
    marginBottom: 8,
  },
  offerText: {
    color: '#4d5665',
    fontSize: 14,
    lineHeight: 1.55,
  },
  proofGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 0.82fr) minmax(0, 1fr)',
    gap: 18,
    alignItems: 'stretch',
  },
  proofGridMobile: {
    gridTemplateColumns: '1fr',
  },
  panel: {
    border: '1px solid #d9d3c9',
    borderRadius: 8,
    background: '#ffffff',
    padding: 18,
    boxShadow: '0 20px 60px rgba(24, 32, 51, 0.09)',
  },
  panelLabel: {
    color: '#8b8173',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  leadCard: {
    borderTop: '3px solid #18794e',
    background: '#f7f8f5',
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  score: {
    color: '#18794e',
    fontSize: 30,
    fontWeight: 900,
  },
  businessName: {
    color: '#182033',
    fontSize: 18,
    fontWeight: 900,
  },
  cardText: {
    color: '#4d5665',
    fontSize: 14,
    lineHeight: 1.55,
  },
  signal: {
    border: '1px solid #b7dfcc',
    borderRadius: 4,
    background: '#e5f4ec',
    color: '#18794e',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 800,
  },
  proofCopy: {
    border: '1px solid #d9d3c9',
    borderRadius: 8,
    background: '#ffffff',
    padding: 22,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 10,
  },
  proofTitle: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 30,
    lineHeight: 1.1,
  },
  proofText: {
    color: '#4d5665',
    fontSize: 15,
    lineHeight: 1.7,
  },
  pricingBand: {
    margin: '0 auto 38px',
    width: 'min(calc(100% - 28px), 1120px)',
    borderTop: '1px solid #d9d3c9',
    borderBottom: '1px solid #d9d3c9',
    padding: '24px 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 18,
  },
  pricingBandMobile: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  price: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 34,
    fontWeight: 800,
    lineHeight: 1,
  },
  priceText: {
    color: '#4d5665',
    fontSize: 14,
    lineHeight: 1.55,
    marginTop: 8,
  },
};
