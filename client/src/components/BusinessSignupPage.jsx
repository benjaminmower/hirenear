import { useEffect, useMemo, useState } from 'react';
import { TARGET_LANES } from '../constants.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

const HIRES_PER_YEAR = ['1-5', '6-20', '21+'];

function Brand() {
  return (
    <a href="/" style={styles.brand}>
      <span style={styles.logoMark} />
      <div style={styles.logoStack}>
        <span style={styles.logoText}>Hire Near</span>
        <span style={styles.logoTagline}>Recruiting intelligence</span>
      </div>
    </a>
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function BusinessSignupPage() {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const [form, setForm] = useState({
    businessName: '',
    contactName: '',
    email: '',
    city: '',
    state: '',
    hiringCategories: [],
    currentHiringChannel: '',
    hiresPerYear: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successName, setSuccessName] = useState('');

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

  const missingRequired = useMemo(() => {
    return !form.businessName.trim() ||
      !form.contactName.trim() ||
      !isValidEmail(form.email.trim()) ||
      !form.city.trim() ||
      !form.state.trim() ||
      form.hiringCategories.length === 0;
  }, [form]);

  const updateField = (field, value) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const toggleCategory = (category) => {
    setForm(current => ({
      ...current,
      hiringCategories: current.hiringCategories.includes(category)
        ? current.hiringCategories.filter(item => item !== category)
        : [...current.hiringCategories, category],
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (missingRequired) {
      setError('Please complete the required fields and choose at least one hiring category.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/business-signups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Signup failed');
      }
      setSuccessName(form.contactName.trim());
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (successName) {
    return (
      <main style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
        <section style={{ ...styles.card, ...(isMobile ? styles.cardMobile : {}) }}>
          <Brand />
          <p style={styles.kicker}>Design partner signup</p>
          <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
            Thanks, {successName}.
          </h1>
          <p style={styles.copy}>
            We'll email you within 48 hours to set up your first batch of candidates.
          </p>
          <p style={styles.signature}>- The Hire Near team</p>
          <a href="/" style={styles.secondaryButton}>See how candidates scout businesses</a>
        </section>
      </main>
    );
  }

  return (
    <main style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <form style={{ ...styles.card, ...(isMobile ? styles.cardMobile : {}) }} onSubmit={handleSubmit}>
        <Brand />
        <div>
          <p style={styles.kicker}>Sign up your business</p>
          <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
            Get qualified local candidates for $50/month.
          </h1>
          <p style={styles.copy}>First 10 businesses to sign up: 3 months free.</p>
        </div>

        <div style={styles.fieldGrid}>
          <label style={styles.label}>
            Business name
            <input
              style={styles.input}
              value={form.businessName}
              onChange={event => updateField('businessName', event.target.value)}
              required
            />
          </label>
          <label style={styles.label}>
            Your name
            <input
              style={styles.input}
              value={form.contactName}
              onChange={event => updateField('contactName', event.target.value)}
              required
            />
          </label>
        </div>

        <label style={styles.label}>
          Email
          <input
            style={styles.input}
            type="email"
            value={form.email}
            onChange={event => updateField('email', event.target.value)}
            required
          />
        </label>

        <div style={styles.fieldGrid}>
          <label style={styles.label}>
            City
            <input
              style={styles.input}
              value={form.city}
              onChange={event => updateField('city', event.target.value)}
              required
            />
          </label>
          <label style={styles.label}>
            State
            <input
              style={styles.input}
              value={form.state}
              onChange={event => updateField('state', event.target.value)}
              required
              maxLength={40}
            />
          </label>
        </div>

        <div style={styles.label}>
          Hiring categories
          <div style={styles.categoryGrid}>
            {TARGET_LANES.map(category => (
              <button
                key={category}
                type="button"
                style={{
                  ...styles.categoryButton,
                  ...(form.hiringCategories.includes(category) ? styles.categoryButtonActive : {}),
                }}
                onClick={() => toggleCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <label style={styles.label}>
          What do you currently use to hire?
          <textarea
            style={styles.textarea}
            value={form.currentHiringChannel}
            onChange={event => updateField('currentHiringChannel', event.target.value)}
            placeholder="Craigslist, Indeed, word of mouth..."
          />
        </label>

        <label style={styles.label}>
          How many people do you hire per year?
          <select
            style={styles.input}
            value={form.hiresPerYear}
            onChange={event => updateField('hiresPerYear', event.target.value)}
          >
            <option value="">Select a range</option>
            {HIRES_PER_YEAR.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" style={styles.button} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Try Hire Near free for 3 months'}
        </button>
      </form>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: '#f7f8f5',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  pageMobile: {
    alignItems: 'stretch',
    padding: 14,
  },
  card: {
    width: 'min(100%, 680px)',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 18,
    padding: 32,
    boxShadow: '0 18px 50px rgba(24, 32, 51, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    color: '#182033',
  },
  cardMobile: {
    minHeight: 'calc(100dvh - 28px)',
    borderRadius: 8,
    padding: 22,
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
  kicker: {
    fontSize: 12,
    fontWeight: 800,
    color: '#8b8173',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 40,
    lineHeight: 1.05,
  },
  titleMobile: {
    fontSize: 32,
  },
  copy: {
    fontSize: 16,
    lineHeight: 1.6,
    color: '#4d5665',
  },
  signature: {
    color: '#182033',
    fontSize: 16,
    fontWeight: 800,
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    color: '#182033',
    fontSize: 13,
    fontWeight: 800,
  },
  input: {
    width: '100%',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: '11px 12px',
    fontSize: 15,
    font: 'inherit',
    fontWeight: 500,
  },
  textarea: {
    width: '100%',
    minHeight: 88,
    resize: 'vertical',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: '11px 12px',
    fontSize: 15,
    font: 'inherit',
    fontWeight: 500,
    lineHeight: 1.5,
  },
  categoryGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryButton: {
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  categoryButtonActive: {
    borderColor: '#182033',
    background: '#182033',
    color: '#ffffff',
  },
  button: {
    border: 'none',
    borderRadius: 6,
    background: '#182033',
    color: '#ffffff',
    padding: '13px 16px',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: '13px 16px',
    fontSize: 14,
    fontWeight: 800,
    textDecoration: 'none',
  },
  error: {
    border: '1px solid #f0b8b8',
    borderRadius: 6,
    background: '#fff5f5',
    color: '#9b1c1c',
    padding: 12,
    fontSize: 14,
    fontWeight: 800,
  },
};
