import { useMediaQuery } from '../hooks/useMediaQuery.js';

const CONTACT_EMAIL = 'benjaminmower@gmail.com';

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

  return (
    <main style={styles.page}>
      <section style={{ ...styles.hero, ...(isMobile ? styles.heroMobile : {}) }}>
        <nav style={styles.nav}>
          <Brand />
          <a href={`mailto:${CONTACT_EMAIL}`} style={styles.navButton}>Talk to us</a>
        </nav>

        <div style={{ ...styles.heroGrid, ...(isMobile ? styles.heroGridMobile : {}) }}>
          <div style={styles.heroCopy}>
            <p style={styles.kicker}>For local businesses</p>
            <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
              Qualified nearby candidates, without another job board.
            </h1>
            <p style={styles.lede}>
              Hire Near introduces people who already reviewed your business, matched their experience to your needs, and asked to be contacted.
            </p>
            <div style={styles.actions}>
              <a href={`mailto:${CONTACT_EMAIL}?subject=Hire Near for my business`} style={styles.primaryButton}>
                Contact Hire Near
              </a>
              <a href="/" style={styles.secondaryButton}>Scout as a job seeker</a>
            </div>
          </div>

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
        </div>
      </section>

      <section style={styles.section}>
        <div style={{ ...styles.steps, ...(isMobile ? styles.stepsMobile : {}) }}>
          <div style={styles.step}>
            <span style={styles.stepNumber}>1</span>
            <h2 style={styles.stepTitle}>A candidate scouts nearby businesses</h2>
            <p style={styles.stepText}>They paste their resume, choose target work, and decide which local businesses are worth contacting.</p>
          </div>
          <div style={styles.step}>
            <span style={styles.stepNumber}>2</span>
            <h2 style={styles.stepTitle}>Hire Near checks public signals</h2>
            <p style={styles.stepText}>We look for hiring pages, contact paths, and role fit using public business information.</p>
          </div>
          <div style={styles.step}>
            <span style={styles.stepNumber}>3</span>
            <h2 style={styles.stepTitle}>You get a simple warm lead</h2>
            <p style={styles.stepText}>If the candidate asks to be introduced, you receive a match link and can reply directly.</p>
          </div>
        </div>
      </section>

      <section style={styles.footerBand}>
        <div>
          <div style={styles.footerTitle}>Want to receive qualified local candidates?</div>
          <p style={styles.footerText}>Reply to the email you received, or contact Hire Near directly.</p>
        </div>
        <a href={`mailto:${CONTACT_EMAIL}?subject=Hire Near business leads`} style={styles.primaryButton}>
          {CONTACT_EMAIL}
        </a>
      </section>
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
    minHeight: '76dvh',
    padding: '24px 28px 52px',
    borderBottom: '1px solid #d9d3c9',
    display: 'flex',
    flexDirection: 'column',
    gap: 54,
  },
  heroMobile: {
    minHeight: 'auto',
    padding: '18px 14px 34px',
    gap: 34,
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
  heroGrid: {
    width: 'min(100%, 1120px)',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.12fr) minmax(320px, 0.88fr)',
    gap: 48,
    alignItems: 'center',
  },
  heroGridMobile: {
    gridTemplateColumns: '1fr',
    gap: 26,
  },
  heroCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  kicker: {
    color: '#8b8173',
    fontSize: 12,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 60,
    lineHeight: 1.02,
    fontWeight: 800,
    maxWidth: 720,
  },
  titleMobile: {
    fontSize: 38,
  },
  lede: {
    color: '#4d5665',
    fontSize: 18,
    lineHeight: 1.65,
    maxWidth: 680,
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
  section: {
    padding: '34px 28px',
  },
  steps: {
    width: 'min(100%, 1120px)',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 14,
  },
  stepsMobile: {
    gridTemplateColumns: '1fr',
  },
  step: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    padding: 18,
  },
  stepNumber: {
    display: 'inline-flex',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: '#f0e6dc',
    color: '#b56d2a',
    fontSize: 13,
    fontWeight: 900,
    marginBottom: 14,
  },
  stepTitle: {
    fontSize: 17,
    lineHeight: 1.3,
    marginBottom: 8,
  },
  stepText: {
    color: '#4d5665',
    fontSize: 14,
    lineHeight: 1.55,
  },
  footerBand: {
    margin: '0 auto',
    width: 'min(calc(100% - 28px), 1120px)',
    borderTop: '1px solid #d9d3c9',
    padding: '26px 0 40px',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 18,
  },
  footerTitle: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 26,
    fontWeight: 800,
    marginBottom: 5,
  },
  footerText: {
    color: '#4d5665',
    fontSize: 14,
  },
};
