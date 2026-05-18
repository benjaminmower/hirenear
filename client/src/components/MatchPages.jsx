import { useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

function Brand() {
  return (
    <div style={styles.brand}>
      <span style={styles.logoMark} />
      <div style={styles.logoStack}>
        <span style={styles.logoText}>Hire Near</span>
        <span style={styles.logoTagline}>Recruiting intelligence</span>
      </div>
    </div>
  );
}

function Shell({ children }) {
  const isMobile = useMediaQuery('(max-width: 700px)');

  return (
    <div style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <div style={{ ...styles.card, ...(isMobile ? styles.cardMobile : {}) }}>
        <Brand />
        {children}
      </div>
    </div>
  );
}

export function MatchPage({ token }) {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState(null);
  const [status, setStatus] = useState('');
  const [errorCode, setErrorCode] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadMatch() {
      setLoading(true);
      setErrorCode('');
      try {
        const res = await fetch(`/api/match/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setErrorCode(res.status === 404 ? 'not_found' : 'error');
          return;
        }

        if (!cancelled) {
          setMatch(data);
          if (data.alreadyContacted) {
            setStatus('already_contacted');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMatch();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const message = useMemo(() => {
    if (errorCode === 'not_found') return 'This match link is no longer valid.';
    if (status === 'done') return 'You’re all set. Check your email app to send your message.';
    if (status === 'already_contacted') return 'You’ve already contacted this person.';
    if (errorCode === 'error') return 'Something went wrong. Please try again.';
    return '';
  }, [errorCode, status]);

  async function handleContact() {
    setStatus('');
    setErrorCode('');

    const res = await fetch(`/api/match/${encodeURIComponent(token)}/contact`, {
      method: 'POST',
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 404) {
      setErrorCode('not_found');
      return;
    }
    if (res.status === 409) {
      setStatus('already_contacted');
      return;
    }
    if (!res.ok || !data.seekerEmail) {
      setErrorCode('error');
      return;
    }

    window.location.href = `mailto:${data.seekerEmail}`;
    setStatus('done');
  }

  return (
    <Shell>
      {loading ? (
        <p style={styles.copy}>Loading match…</p>
      ) : errorCode === 'not_found' ? (
        <p style={styles.message}>{message}</p>
      ) : (
        <>
          <p style={styles.kicker}>Match ready</p>
          <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>{match?.businessName}</h1>
          <div style={{ ...styles.score, ...(isMobile ? styles.scoreMobile : {}) }}>{match?.fitScore}% fit</div>
          <p style={styles.copy}>Someone scouted your location and is interested in working with you.</p>
          {status === 'done' || status === 'already_contacted' ? (
            <p style={styles.message}>{message}</p>
          ) : (
            <button type="button" style={styles.button} onClick={handleContact}>
              Contact this person
            </button>
          )}
          {errorCode === 'error' && <p style={styles.error}>{message}</p>}
        </>
      )}
    </Shell>
  );
}

export function MatchConfirmPage({ token }) {
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function confirmMatch() {
      setLoading(true);
      try {
        const res = await fetch(`/api/match/${encodeURIComponent(token)}/confirm`);
        if (!cancelled) {
          setInvalid(res.status === 404);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    confirmMatch();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Shell>
      {loading ? (
        <p style={styles.copy}>Loading confirmation…</p>
      ) : invalid ? (
        <p style={styles.message}>This confirmation link is no longer valid.</p>
      ) : (
        <p style={styles.message}>Thanks for letting us know. We’re glad Hirenear could help.</p>
      )}
    </Shell>
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
    width: 'min(100%, 540px)',
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
    justifyContent: 'center',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
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
  },
  title: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 40,
    lineHeight: 1.05,
  },
  titleMobile: {
    fontSize: 32,
  },
  score: {
    fontSize: 26,
    fontWeight: 800,
    color: '#18794e',
  },
  scoreMobile: {
    fontSize: 22,
  },
  copy: {
    fontSize: 16,
    lineHeight: 1.6,
    color: '#4d5665',
  },
  message: {
    fontSize: 18,
    lineHeight: 1.6,
    color: '#182033',
  },
  error: {
    fontSize: 14,
    color: '#b42318',
  },
  button: {
    border: 'none',
    borderRadius: 999,
    background: '#182033',
    color: '#ffffff',
    padding: '14px 18px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
};
