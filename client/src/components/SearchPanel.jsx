import { useState } from 'react';

const DATE_FILTERS = [
  { label: 'Any time', value: '' },
  { label: 'Past month', value: 'month' },
  { label: 'Past week', value: 'week' },
  { label: 'Past 3 days', value: '3days' },
  { label: 'Today', value: 'today' },
];

export default function SearchPanel({ onSearch, loading }) {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch({ query, location, dateFilter });
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.row}>
        <div style={styles.inputGroup}>
          <span style={styles.icon}>⌕</span>
          <input
            style={styles.input}
            type="text"
            placeholder="Job title, skills, company..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            required
          />
        </div>
        <div style={styles.inputGroup}>
          <span style={styles.icon}>◎</span>
          <input
            style={styles.input}
            type="text"
            placeholder="Location (optional)"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />
        </div>
        <select
          style={styles.select}
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
        >
          {DATE_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <button style={styles.button} type="submit" disabled={loading}>
          {loading ? '...' : 'Search'}
        </button>
      </div>
    </form>
  );
}

const styles = {
  form: {
    padding: '0 16px',
    flex: 1,
  },
  row: {
    display: 'flex',
    gap: 8,
    height: '100%',
    alignItems: 'center',
  },
  inputGroup: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  icon: {
    position: 'absolute',
    left: 10,
    color: 'var(--text-muted)',
    fontSize: 16,
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    padding: '8px 10px 8px 30px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  select: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-secondary)',
    padding: '8px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  button: {
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 'var(--radius)',
    color: '#fff',
    padding: '8px 20px',
    fontSize: 13,
    fontFamily: 'inherit',
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
};
