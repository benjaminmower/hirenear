const CONTACT_EMAIL = 'hello@hirenear.app';

export default function PublicFooter() {
  return (
    <footer style={styles.footer}>
      <div style={styles.inner}>
        <div style={styles.brand}>Hire Near</div>
        <nav style={styles.links} aria-label="Footer">
          <a href="/for-businesses" style={styles.link}>For businesses</a>
          <a href="/terms" style={styles.link}>Terms</a>
          <a href="/privacy" style={styles.link}>Privacy</a>
          <a href={`mailto:${CONTACT_EMAIL}`} style={styles.link}>{CONTACT_EMAIL}</a>
        </nav>
      </div>
    </footer>
  );
}

const styles = {
  footer: {
    borderTop: '1px solid #d9d3c9',
    background: '#ffffff',
    color: '#6f5f4c',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  inner: {
    width: 'min(calc(100% - 28px), 1120px)',
    margin: '0 auto',
    padding: '18px 0',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  brand: {
    color: '#182033',
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 18,
    fontWeight: 800,
  },
  links: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 14,
    alignItems: 'center',
  },
  link: {
    color: '#6f5f4c',
    fontSize: 13,
    fontWeight: 800,
    textDecoration: 'none',
  },
};
