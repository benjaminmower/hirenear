import { useMemo, useState, useCallback, useEffect } from 'react';
import { TARGET_LANES } from '../constants.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

const RADII = [
  { label: '0.5 mi', value: 805 },
  { label: '1 mi', value: 1609 },
  { label: '2 mi', value: 3219 },
  { label: '3 mi', value: 5000 },
];

const SETUP_STEPS = ['area', 'resume', 'lanes', 'launch'];
const INTEREST_THRESHOLD = 80;
const MAX_MATCH_SIGNALS = 6;

const STEP_META = {
  area: {
    eyebrow: 'Search mandate',
    title: 'Where should we focus?',
    copy: 'Choose the market that matters most. Hire Near will build a local recruiting map from that point outward.',
  },
  resume: {
    eyebrow: 'Candidate profile',
    title: 'Who are we representing?',
    copy: 'Paste the resume text so each business can be evaluated through the lens of real experience, not generic keywords.',
  },
  lanes: {
    eyebrow: 'Target market',
    title: 'What roles should we prioritize?',
    copy: 'Select up to 3 lanes. A tighter mandate produces a stronger ranked list.',
  },
  launch: {
    eyebrow: 'Search brief',
    title: 'Ready for review',
    copy: 'Hire Near will identify nearby businesses first. You decide which doors are worth opening.',
  },
};

function signalLabel(signal) {
  return {
    queued: 'Queued',
    checking: 'Checking',
    strong: 'Strong signal',
    weak: 'Contact path',
    none: 'No signal',
    failed: 'Failed',
  }[signal] || 'Queued';
}

function signalStyle(signal) {
  return {
    strong: styles.badgeStrong,
    weak: styles.badgeWeak,
    failed: styles.badgeFailed,
    checking: styles.badgeChecking,
    none: styles.badgeMuted,
    queued: styles.badgeMuted,
  }[signal] || styles.badgeMuted;
}

function matchSignalStyle(weight) {
  return {
    positive: styles.matchSignalPositive,
    neutral: styles.matchSignalNeutral,
    negative: styles.matchSignalNegative,
  }[weight] || styles.matchSignalNeutral;
}

function matchSignalPrefix(weight) {
  return {
    positive: '✓',
    neutral: '~',
    negative: '✗',
  }[weight] || '~';
}

function validMatchSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals
    .filter(item => item && typeof item.label === 'string' && item.label.trim())
    .filter(item => ['positive', 'neutral', 'negative'].includes(item.weight))
    .slice(0, MAX_MATCH_SIGNALS);
}

function cleanProfileArray(items, max = 6) {
  return Array.isArray(items)
    ? items.filter(item => typeof item === 'string' && item.trim()).slice(0, max)
    : [];
}

function profileHasDetails(profile) {
  if (!profile) return false;
  return Boolean(
    profile.industry ||
    profile.foundedYear ||
    profile.sizeCue ||
    cleanProfileArray(profile.services, 4).length ||
    cleanProfileArray(profile.signals, 6).length
  );
}

function businessPlaceMeta(business) {
  const pieces = [];
  if (business.primaryTypeDisplayName) pieces.push(business.primaryTypeDisplayName);
  if (business.rating) {
    const count = businessReviewCount(business);
    pieces.push(`★ ${business.rating}${count ? ` (${count})` : ''}`);
  }
  return pieces.join(' · ');
}

function businessReviewCount(business) {
  return Number(business.userRatingCount ?? business.userRatingsTotal ?? business.user_ratings_total ?? 0) || 0;
}

function businessRating(business) {
  return Number(business.rating || 0) || 0;
}

function compareQueuedBusinesses(a, b) {
  const scoreDelta = (Number(b.discoveryScore || 0) || 0) - (Number(a.discoveryScore || 0) || 0);
  if (scoreDelta !== 0) return scoreDelta;
  const reviewDelta = businessReviewCount(b) - businessReviewCount(a);
  if (reviewDelta !== 0) return reviewDelta;
  const ratingDelta = businessRating(b) - businessRating(a);
  if (ratingDelta !== 0) return ratingDelta;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function queueLeadBand(discoveryScore) {
  const score = Number(discoveryScore || 0) || 0;
  if (score >= 250) return 'Strong lead';
  if (score >= 100) return 'Worth checking';
  return 'Long shot';
}

function queueBandStyle(discoveryScore) {
  const score = Number(discoveryScore || 0) || 0;
  if (score >= 250) return styles.queueBandStrong;
  if (score >= 100) return styles.queueBandMedium;
  return styles.queueBandLow;
}

function hasStrongSearchApiOpportunity(businessOpportunities) {
  return businessOpportunities.some(item => item.source === 'searchapi' && item.signalStrength === 'strong');
}

function whyQueued(business, businessOpportunities) {
  if (business.discoverySource === 'job_search' || hasStrongSearchApiOpportunity(businessOpportunities)) {
    return 'Job posting found';
  }
  if (business.discoverySource === 'employer_search') {
    return `Matches your search: ${business.discoveryQuery || 'local employer search'}`;
  }
  return 'Nearby business worth a look';
}

function queueSummary(queuedBusinesses) {
  const strongLeads = queuedBusinesses.filter(item => Number(item.discoveryScore || 0) >= 250).length;
  if (strongLeads > 0) return `${strongLeads} strong lead${strongLeads === 1 ? '' : 's'} in queue`;
  return `${queuedBusinesses.length} door${queuedBusinesses.length === 1 ? '' : 's'} in queue`;
}

function bestBusinessLink(business, opportunities) {
  const websiteOpportunity = opportunities.find(item => item.source === 'website' && item.url);
  const anyOpportunity = opportunities.find(item => item.url);
  const evidenceUrl = (business.evidence || []).find(item => item.url)?.url;
  const url = websiteOpportunity?.url || evidenceUrl || anyOpportunity?.url || business.website;

  if (!url) return null;
  return {
    url,
    label: websiteOpportunity || evidenceUrl ? 'View hiring page' : 'View website',
  };
}

function runStage({ searchPin, resumeText, targetLanes, hasRun, isRunning, complete }) {
  if (complete) return 'Report ready';
  if (isRunning) return 'Walking queue';
  if (hasRun) return 'Run paused';
  if (!searchPin) return 'Drop a pin';
  if (resumeText.trim().length < 40) return 'Paste resume';
  if (targetLanes.length === 0) return 'Choose lanes';
  return 'Ready to scout';
}

function isValidEmail(email) {
  if (!email || email.length > 254 || email.includes(' ')) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain || !domain.includes('.')) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return true;
}

function radiusLabel(value) {
  const option = RADII.find(item => item.value === Number(value));
  if (option) return option.label;
  const miles = Number(value) / 1609.344;
  if (!Number.isFinite(miles)) return '';
  return `${miles >= 10 ? Math.round(miles) : miles.toFixed(miles < 1 ? 1 : 0)} mi`;
}

export default function ScoutPanel({
  scout,
  searchPin,
  locationLabel,
  radius,
  onRadiusChange,
  onSelectBusiness,
  selectedBusiness,
  onClose,
}) {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const [resumeText, setResumeText] = useState(scout.run?.resumeText || '');
  const [targetLanes, setTargetLanes] = useState(scout.run?.targetLanes || []);
  const [avoidTerms, setAvoidTerms] = useState(scout.run?.avoidTerms || '');
  const [visiting, setVisiting] = useState(false);
  const [setupStep, setSetupStep] = useState('area');
  const [interestEmail, setInterestEmail] = useState('');
  const [interestSubmitting, setInterestSubmitting] = useState(false);
  const [interestSubmittedRunId, setInterestSubmittedRunId] = useState(null);
  const [interestResult, setInterestResult] = useState(null);
  const [interestError, setInterestError] = useState('');
  const [reportDismissedRunId, setReportDismissedRunId] = useState(null);
  const [expandedProfiles, setExpandedProfiles] = useState({});
  const [profile, setProfile] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('hirenear:userProfile') || '{}');
    } catch {
      return {};
    }
  });
  const businesses = scout.businesses || [];
  const opportunities = scout.opportunities || [];
  const matches = scout.matches || [];

  const queuedBusinesses = useMemo(() =>
    [...businesses.filter(b => b.inspectionStatus === 'queued')].sort(compareQueuedBusinesses),
    [businesses]
  );
  const decidedBusinesses = useMemo(() =>
    [...businesses.filter(b => b.inspectionStatus !== 'queued')]
      .sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0)),
    [businesses]
  );
  const highFitBusinesses = useMemo(
    () => decidedBusinesses.filter(b => b.inspectionStatus !== 'skipped' && Number(b.fitScore) >= INTEREST_THRESHOLD),
    [decidedBusinesses]
  );

  // The next business the user should decide on
  const nextBusiness = queuedBusinesses[0] ?? null;
  // The one currently being inspected (checking state)
  const checkingBusiness = businesses.find(b => b.inspectionStatus === 'checking') ?? null;
  const activeBusiness = checkingBusiness || nextBusiness;

  const hasRun = !!scout.run?.id;
  const isDiscovering = scout.loading && businesses.length === 0;
  const isRunning = hasRun && scout.run?.status === 'running';
  const complete = scout.run?.status === 'complete';
  const visitedCount = decidedBusinesses.filter(b => b.inspectionStatus !== 'skipped').length;
  const skippedCount = decidedBusinesses.filter(b => b.inspectionStatus === 'skipped').length;
  const strongCount = businesses.filter(b => b.signalStrength === 'strong').length;
  const stage = runStage({ searchPin, resumeText, targetLanes, hasRun, isRunning, complete });
  const resumeReady = resumeText.trim().length >= 40;
  const lanesReady = targetLanes.length > 0;
  const canStart = Boolean(searchPin && resumeReady && lanesReady && !isRunning && !isDiscovering);
  const showReport = complete && scout.summary && reportDismissedRunId !== scout.run?.id;
  const displayLocationLabel = scout.run?.locationLabel || locationLabel || (searchPin ? 'Dropped pin' : '');
  const sx = useCallback((key) => ({
    ...styles[key],
    ...(isMobile && mobileStyles[key] ? mobileStyles[key] : {}),
  }), [isMobile]);

  useEffect(() => {
    if (!scout.run) return;
    setTargetLanes(scout.run.targetLanes || []);
    setAvoidTerms(scout.run.avoidTerms || '');
  }, [scout.run?.id]);

  useEffect(() => {
    setInterestEmail(profile.email || '');
    setInterestSubmitting(false);
    setInterestSubmittedRunId(null);
    setInterestResult(null);
    setInterestError('');
    setReportDismissedRunId(null);
    setExpandedProfiles({});
  }, [scout.run?.id]);

  const handleStart = () => {
    if (!searchPin) return;
    setInterestSubmittedRunId(null);
    setInterestResult(null);
    setReportDismissedRunId(null);
    setInterestError('');
    scout.startScout({
      resumeText,
      targetLanes,
      avoidTerms,
      lat: searchPin.lat,
      lng: searchPin.lng,
      radius,
      locationLabel: displayLocationLabel || 'Dropped pin',
    });
  };

  const goNext = () => {
    const index = SETUP_STEPS.indexOf(setupStep);
    setSetupStep(SETUP_STEPS[Math.min(index + 1, SETUP_STEPS.length - 1)]);
  };

  const goBack = () => {
    const index = SETUP_STEPS.indexOf(setupStep);
    setSetupStep(SETUP_STEPS[Math.max(index - 1, 0)]);
  };

  const toggleLane = (lane) => {
    setTargetLanes(current => {
      if (current.includes(lane)) return current.filter(item => item !== lane);
      if (current.length >= 3) return current;
      return [...current, lane];
    });
  };

  const handleSubmitInterest = async () => {
    if (!scout.run?.id || highFitBusinesses.length === 0 || interestSubmitting) return;

    const seekerEmail = interestEmail.trim().toLowerCase();
    if (!isValidEmail(seekerEmail)) {
      setInterestError('Please enter a valid email address.');
      return;
    }

    setInterestSubmitting(true);
    setInterestError('');

    try {
      const res = await fetch(`/api/scout-runs/${scout.run.id}/interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seekerEmail,
          businessPlaceIds: highFitBusinesses.map(item => item.placeId),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to notify businesses');
      }

      setInterestSubmittedRunId(scout.run.id);
      setInterestResult(data);
      setInterestEmail(seekerEmail);
      setProfile(current => ({ ...current, email: seekerEmail }));
      localStorage.setItem('hirenear:userProfile', JSON.stringify({
        ...profile,
        email: seekerEmail,
      }));
    } catch (err) {
      setInterestError(err.message || 'Failed to notify businesses');
    } finally {
      setInterestSubmitting(false);
    }
  };

  const interestDoneMessage = useMemo(() => {
    if (!interestResult) return 'Interest saved.';
    const sent = Number(interestResult.notification?.sent || 0);
    const willNotify = Number(interestResult.willNotify || 0);
    if (sent > 0) {
      return `Done. We sent your interest to ${sent} business${sent === 1 ? '' : 'es'} with contact info.`;
    }
    if (willNotify > 0 && interestResult.notification?.configured === false) {
      return `Interest saved for ${willNotify} business${willNotify === 1 ? '' : 'es'} with contact info, but outbound email is not configured on this server.`;
    }
    if (willNotify > 0) {
      return `Interest saved. We found contact info for ${willNotify} business${willNotify === 1 ? '' : 'es'}, but no emails were sent.`;
    }
    return 'Interest saved. We did not find contact info for those businesses yet.';
  }, [interestResult]);

  const handleVisit = useCallback(async (business) => {
    setVisiting(true);
    await scout.visitBusiness(business.placeId);
    setVisiting(false);
  }, [scout]);

  const handleSkip = useCallback(async (business) => {
    await scout.skipBusiness(business.placeId);
  }, [scout]);

  const toggleBusinessProfile = useCallback((businessId) => {
    setExpandedProfiles(current => ({ ...current, [businessId]: !current[businessId] }));
  }, []);

  const handleDelete = async () => {
    try {
      await scout.deleteRun();
      setResumeText('');
    } catch (err) {
      console.error(err);
    }
  };

  // Auto-select the active business so map flies to it
  useEffect(() => {
    if (activeBusiness && (!selectedBusiness || selectedBusiness.id !== activeBusiness.id)) {
      onSelectBusiness(activeBusiness);
    }
  }, [activeBusiness, selectedBusiness, onSelectBusiness]);

  useEffect(() => {
    if (searchPin && setupStep === 'area') setSetupStep('resume');
  }, [searchPin, setupStep]);

  if (!hasRun && !isDiscovering) {
    const currentStepIndex = SETUP_STEPS.indexOf(setupStep);
    const stepMeta = STEP_META[setupStep];

    return (
      <div style={sx('setupOverlay')} role="dialog" aria-modal="true" aria-label="Scout setup">
        <div style={sx('setupShell')}>
          <div style={sx('setupHeader2')}>
            <div>
              <div style={styles.eyebrow}>{stepMeta.eyebrow}</div>
              <div style={sx('setupTitle')}>{stepMeta.title}</div>
            </div>
            <button
              type="button"
              style={styles.setupCloseButton}
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          <div style={sx('stageCopy')}>{stepMeta.copy}</div>

          <div style={sx('progressTrack')}>
            {SETUP_STEPS.map((step, index) => (
              <button
                key={step}
                type="button"
                style={{
                  ...styles.progressStep,
                  ...(index <= currentStepIndex ? styles.progressStepActive : {}),
                }}
                onClick={() => setSetupStep(step)}
              >
                {step === 'area' && 'Area'}
                {step === 'resume' && 'Resume'}
                {step === 'lanes' && 'Lanes'}
                {step === 'launch' && 'Launch'}
              </button>
            ))}
          </div>

          <div style={sx('setupStage')}>
          {setupStep === 'area' && (
            <>
              <div style={styles.pinReadout}>
                <span style={styles.readoutLabel}>Selected area</span>
                <strong>{searchPin ? displayLocationLabel : 'Waiting for a pin'}</strong>
                <span>{searchPin ? `${searchPin.lat.toFixed(4)}, ${searchPin.lng.toFixed(4)}` : 'Click the map to set the search center.'}</span>
              </div>
              <div style={sx('marketNotes')}>
                <div style={styles.marketNote}>
                  <strong style={styles.marketNoteTitle}>Local-first</strong>
                  <span>Built around real businesses near the candidate.</span>
                </div>
                <div style={styles.marketNote}>
                  <strong style={styles.marketNoteTitle}>Human-paced</strong>
                  <span>No website is checked until you choose to visit.</span>
                </div>
              </div>
            </>
          )}

          {setupStep === 'resume' && (
            <>
              <textarea
                style={sx('setupTextarea')}
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
                placeholder="Paste resume text here..."
              />
              <div style={styles.hint}>
                {resumeReady ? 'Profile is ready for matching.' : 'Add at least a few lines of resume text.'}
              </div>
            </>
          )}

          {setupStep === 'lanes' && (
            <>
              <div style={sx('setupLaneGrid')}>
                {TARGET_LANES.map(lane => (
                  <button
                    key={lane}
                    type="button"
                    style={{
                      ...styles.setupLaneButton,
                      ...(targetLanes.includes(lane) ? styles.setupLaneButtonActive : {}),
                    }}
                    onClick={() => toggleLane(lane)}
                  >
                    {lane}
                  </button>
                ))}
              </div>
              <div style={styles.hint}>{targetLanes.length}/3 selected</div>
            </>
          )}

          {setupStep === 'launch' && (
            <>
              <div style={styles.reviewRows}>
                <div style={sx('reviewRow')}>
                  <span>Area</span>
                  <strong>{searchPin ? displayLocationLabel : 'Missing pin'}</strong>
                </div>
                <div style={sx('reviewRow')}>
                  <span>Resume</span>
                  <strong>{resumeReady ? 'Ready' : 'Needs more text'}</strong>
                </div>
                <div style={sx('reviewRow')}>
                  <span>Lanes</span>
                  <strong>{targetLanes.length ? targetLanes.join(', ') : 'None selected'}</strong>
                </div>
                <div style={sx('reviewRow')}>
                  <span>Radius</span>
                  <select
                    style={styles.inlineSelect}
                    value={radius}
                    onChange={e => onRadiusChange(Number(e.target.value))}
                  >
                    {RADII.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={styles.notice}>
                Resume text is sent to this server and Claude's API for matching. Hire Near stores hiring classifications and evidence URLs, and deletes scout runs after 30 days.
              </div>
            </>
          )}
        </div>

          {scout.error && <div style={styles.error}>{scout.error}</div>}

          <div style={sx('setupActions')}>
            <button
              type="button"
              style={styles.backButton}
              onClick={goBack}
              disabled={setupStep === 'area'}
            >
              Back
            </button>
            {setupStep === 'launch' ? (
              <button
                type="button"
                style={styles.primarySetupButton}
                disabled={!canStart}
                onClick={handleStart}
              >
                Scout this area
              </button>
            ) : (
              <button
                type="button"
                style={styles.primarySetupButton}
                disabled={
                  (setupStep === 'area' && !searchPin) ||
                  (setupStep === 'resume' && !resumeReady) ||
                  (setupStep === 'lanes' && !lanesReady)
                }
                onClick={goNext}
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={sx('scoutOverlay')} role="dialog" aria-modal="true" aria-label="Scout run">
      <div style={sx('scoutShell')}>
        {/* Scout header with close button */}
        <div style={sx('scoutHeader')}>
          <div>
            <div style={styles.eyebrow}>Scout run</div>
            <div style={sx('runTitle')}>{stage}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={styles.runPill}>{searchPin ? radiusLabel(radius) : 'No pin'}</div>
            <button
              type="button"
              style={styles.scoutCloseButton}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Setup controls */}
        <div style={sx('controls')}>
        <div style={sx('stepRow')}>
          <span style={{ ...styles.step, ...(searchPin ? styles.stepDone : {}) }}>Pin</span>
          <span style={{ ...styles.step, ...(resumeText.trim().length >= 40 ? styles.stepDone : {}) }}>Resume</span>
          <span style={{ ...styles.step, ...(targetLanes.length > 0 ? styles.stepDone : {}) }}>Lanes</span>
          <span style={{ ...styles.step, ...(hasRun ? styles.stepDone : {}) }}>Walk</span>
        </div>
        <textarea
          style={sx('textarea')}
          value={resumeText}
          onChange={e => setResumeText(e.target.value)}
          placeholder="Paste resume text here..."
          disabled={isRunning || isDiscovering}
        />
        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>What kind of work?</div>
          <div style={sx('laneGrid')}>
            {TARGET_LANES.map(lane => (
              <button
                key={lane}
                type="button"
                style={{
                  ...styles.laneButton,
                  ...(targetLanes.includes(lane) ? styles.laneButtonActive : {}),
                }}
                disabled={isRunning || isDiscovering}
                onClick={() => toggleLane(lane)}
              >
                {lane}
              </button>
            ))}
          </div>
          <div style={styles.hint}>Choose up to 3. This steers search and ranking.</div>
        </div>
        <input
          style={styles.input}
          value={avoidTerms}
          onChange={e => setAvoidTerms(e.target.value)}
          placeholder="Avoid jobs like: barista, server, cashier"
          disabled={isRunning || isDiscovering}
        />
        <div style={sx('controlRow')}>
          <select
            style={styles.select}
            value={radius}
            onChange={e => onRadiusChange(Number(e.target.value))}
            disabled={isRunning || isDiscovering}
          >
            {RADII.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            style={styles.button}
            disabled={isRunning || isDiscovering || !searchPin || resumeText.trim().length < 40 || targetLanes.length === 0}
            onClick={handleStart}
          >
            {isDiscovering ? 'Finding businesses...' : isRunning ? 'Scouting...' : 'Scout this area'}
          </button>
        </div>
        <div style={styles.hint}>
          {searchPin ? `${displayLocationLabel}: ${searchPin.lat.toFixed(4)}, ${searchPin.lng.toFixed(4)}` : 'Click the map to drop a scout pin.'}
        </div>
        <div style={styles.notice}>
          Resume text is sent to this server and Claude's API for matching. Hire Near checks public business websites only after you click Visit, stores hiring classifications and evidence URLs, and deletes scout runs after 30 days.
        </div>
        {scout.error && <div style={styles.error}>{scout.error}</div>}
        {hasRun && (
          <button type="button" style={styles.deleteButton} onClick={handleDelete}>
            Delete this run
          </button>
        )}
      </div>

      {/* Stats bar */}
      {businesses.length > 0 && (
        <div style={sx('stats')}>
          <span>{businesses.length} places</span>
          <span>{queuedBusinesses.length} queued</span>
          <span>{visitedCount} visited</span>
          <span>{skippedCount} skipped</span>
          <span>{strongCount} strong</span>
        </div>
      )}

      {/* Game mechanic: Next Stop card */}
      {isRunning && activeBusiness && (
        <div style={sx('nextStop')}>
          <div style={styles.nextStopLabel}>
            {checkingBusiness ? 'Inspecting website' : 'Next stop'}
          </div>
          <div style={styles.nextStopQueueMeta}>
            {queueSummary(checkingBusiness ? [checkingBusiness, ...queuedBusinesses] : queuedBusinesses)}
          </div>
          <div style={styles.nextStopName}>{activeBusiness.name}</div>
          {(activeBusiness.primaryTypeDisplayName || activeBusiness.category) && (
            <div style={styles.nextStopCategory}>{activeBusiness.primaryTypeDisplayName || activeBusiness.category}</div>
          )}
          <div style={styles.nextStopMeta}>{activeBusiness.vicinity}</div>
          {activeBusiness.website && (
            <div style={styles.nextStopWebsite}>{activeBusiness.website.replace(/^https?:\/\//, '')}</div>
          )}
          {checkingBusiness ? (
            <div style={styles.checking}>
              <span style={styles.checkingDot} />
              Checking public pages...
            </div>
          ) : (
            <div style={sx('nextStopActions')}>
              <button
                type="button"
                style={styles.visitButton}
                onClick={() => handleVisit(nextBusiness)}
                disabled={visiting}
              >
                {visiting ? 'Visiting...' : 'Visit'}
              </button>
              <button
                type="button"
                style={styles.skipButton}
                onClick={() => handleSkip(nextBusiness)}
                disabled={visiting}
              >
                Skip
              </button>
            </div>
          )}
        </div>
      )}

      {/* All queued done, no more to visit */}
      {isRunning && !activeBusiness && !complete && (
        <div style={styles.allDonePrompt}>
          Walk complete. Building ranked report...
        </div>
      )}

      {complete && scout.summary && (
        <div style={sx('reportLauncher')}>
          <div>
            <div style={styles.reportLauncherTitle}>Scout report ready</div>
            <div style={styles.reportLauncherMeta}>{visitedCount} visited · {highFitBusinesses.length} top fits</div>
          </div>
          <button
            type="button"
            style={styles.reportLauncherButton}
            onClick={() => setReportDismissedRunId(null)}
          >
            Open report
          </button>
        </div>
      )}

      {complete && interestSubmittedRunId === scout.run?.id && (
        <div style={styles.interestDone}>
          {interestDoneMessage}
        </div>
      )}

      {/* Visited/decided businesses log */}
      <div style={sx('list')}>
        {isRunning && queuedBusinesses.length > 0 && (
          <div style={styles.queueSection}>
            <div style={sx('queueSectionHeader')}>
              <div>
                <div style={styles.eyebrow}>Street queue</div>
                <div style={styles.queueTitle}>Doors worth opening</div>
              </div>
              <div style={styles.queueCount}>{queuedBusinesses.length} queued</div>
            </div>
            <div style={styles.queueCards}>
              {queuedBusinesses.map((business, index) => {
                const businessOpportunities = opportunities.filter(item => item.businessId === business.id);
                const selected = selectedBusiness?.id === business.id;
                const placeMeta = businessPlaceMeta(business);
                return (
                  <div
                    key={business.id}
                    style={{ ...styles.queueCard, ...(selected ? styles.cardSelected : {}) }}
                    onClick={() => onSelectBusiness(selected ? null : business)}
                  >
                    <div style={sx('queueCardHeader')}>
                      <div style={styles.queueRank}>{index + 1}</div>
                      <div style={styles.queueCardTitleBlock}>
                        <div style={styles.queueCardTitle}>{business.name}</div>
                        {placeMeta && <div style={styles.queueCardMeta}>{placeMeta}</div>}
                      </div>
                      <span style={{ ...styles.queueBand, ...queueBandStyle(business.discoveryScore) }}>
                        {queueLeadBand(business.discoveryScore)}
                      </span>
                    </div>
                    {business.vicinity && <div style={styles.queueVicinity}>{business.vicinity}</div>}
                    <div style={styles.queueWhy}>{whyQueued(business, businessOpportunities)}</div>
                    {business.website && (
                      <a
                        style={styles.queueWebsite}
                        href={business.website}
                        target="_blank"
                        rel="noreferrer"
                        onClick={event => event.stopPropagation()}
                      >
                        {String(business.website).replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </a>
                    )}
                    <div style={styles.queueActions}>
                      <button
                        type="button"
                        style={styles.queueVisitButton}
                        onClick={event => {
                          event.stopPropagation();
                          handleVisit(business);
                        }}
                        disabled={visiting}
                      >
                        {visiting ? 'Visiting...' : 'Visit'}
                      </button>
                      <button
                        type="button"
                        style={styles.queueSkipButton}
                        onClick={event => {
                          event.stopPropagation();
                          handleSkip(business);
                        }}
                        disabled={visiting}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {decidedBusinesses.length === 0 && !isRunning && (
          <div style={styles.empty}>Drop a pin, paste a resume, choose up to 3 lanes, then start walking nearby businesses.</div>
        )}
        {decidedBusinesses.map(business => {
          const businessOpportunities = opportunities.filter(item => item.businessId === business.id);
          const primaryLink = bestBusinessLink(business, businessOpportunities);
          const matchSignals = validMatchSignals(business.matchSignals);
          const selected = selectedBusiness?.id === business.id;
          const signal = business.inspectionStatus === 'checking' ? 'checking'
            : business.inspectionStatus === 'skipped' ? 'none'
            : business.signalStrength;
          const placeMeta = businessPlaceMeta(business);
          const profile = business.companyProfile;
          const profileExpanded = Boolean(expandedProfiles[business.id]);
          const showProfilePlaceholder = !complete &&
            business.inspectionStatus !== 'skipped' &&
            business.inspectionStatus !== 'failed' &&
            !profile?.blurb &&
            business.fitScore == null;
          const services = cleanProfileArray(profile?.services, 4);
          const profileSignals = cleanProfileArray(profile?.signals, 6);
          return (
            <div
              key={business.id}
              style={{ ...styles.card, ...(selected ? styles.cardSelected : {}), ...(business.inspectionStatus === 'skipped' ? styles.cardSkipped : {}) }}
              onClick={() => onSelectBusiness(selected ? null : business)}
            >
              <div style={sx('cardHeader')}>
                <span style={styles.title}>{business.name}</span>
                <span style={{ ...styles.badge, ...signalStyle(signal) }}>
                  {business.inspectionStatus === 'skipped' ? 'Skipped' : signalLabel(signal)}
                </span>
              </div>
              <div style={styles.meta}>{business.vicinity}</div>
              {placeMeta && <div style={styles.placeMeta}>{placeMeta}</div>}
              {profile?.blurb ? (
                <div style={styles.companyBlurb} title={profile.blurb}>{profile.blurb}</div>
              ) : showProfilePlaceholder ? (
                <div style={styles.companyBlurbMuted}>Learning about this business...</div>
              ) : null}
              {(profileHasDetails(profile) || business.googleMapsUri || cleanProfileArray(business.weekdayDescriptions, 7).length > 0) && (
                <button
                  type="button"
                  style={styles.profileToggle}
                  onClick={event => {
                    event.stopPropagation();
                    toggleBusinessProfile(business.id);
                  }}
                >
                  {profileExpanded ? 'Hide business details' : 'More about this business'}
                </button>
              )}
              {profileExpanded && (
                <div style={styles.companyProfile}>
                  <div style={styles.profileFacts}>
                    {profile?.industry && <span>{profile.industry}</span>}
                    {profile?.foundedYear && <span>Founded {profile.foundedYear}</span>}
                    {profile?.sizeCue && <span>{profile.sizeCue}</span>}
                    {business.businessStatus && <span>{business.businessStatus.replace(/_/g, ' ').toLowerCase()}</span>}
                  </div>
                  {services.length > 0 && (
                    <div style={styles.chipRow}>
                      {services.map(item => <span key={`service:${business.id}:${item}`} style={styles.serviceChip}>{item}</span>)}
                    </div>
                  )}
                  {profileSignals.length > 0 && (
                    <div style={styles.chipRow}>
                      {profileSignals.map(item => <span key={`signal:${business.id}:${item}`} style={styles.signalChip}>{item}</span>)}
                    </div>
                  )}
                  {cleanProfileArray(business.weekdayDescriptions, 7).length > 0 && (
                    <div style={styles.hoursList}>
                      {cleanProfileArray(business.weekdayDescriptions, 7).map(item => (
                        <div key={`hours:${business.id}:${item}`}>{item}</div>
                      ))}
                    </div>
                  )}
                  {business.googleMapsUri && (
                    <a style={styles.link} href={business.googleMapsUri} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                      Open in Google Maps
                    </a>
                  )}
                </div>
              )}
              {business.inspectionStatus !== 'skipped' && (
                <>
                  <div style={sx('scoreRow')}>
                    <span style={styles.score}>{business.fitScore ?? '--'}</span>
                    <span style={styles.reason}>{business.fitReason || business.signalSummary || 'Inspecting...'}</span>
                  </div>
                  {matchSignals.length > 0 && (
                    <div style={styles.matchSignals}>
                      {matchSignals.map(signalItem => (
                        <div key={`${signalItem.weight}:${signalItem.label}`} style={{ ...styles.matchSignalItem, ...matchSignalStyle(signalItem.weight) }}>
                          {matchSignalPrefix(signalItem.weight)} {signalItem.label}
                        </div>
                      ))}
                    </div>
                  )}
                  {matchSignals.length > 0 && business.matchSummary && (
                    <div style={styles.matchSummary}>{business.matchSummary}</div>
                  )}
                </>
              )}
              {selected && business.inspectionStatus !== 'skipped' && (
                <div style={styles.details}>
                  {primaryLink && (
                    <a style={styles.link} href={primaryLink.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                      {primaryLink.label}
                    </a>
                  )}
                  {business.nextStep && <div style={styles.nextStep}>{business.nextStep}</div>}
                  {businessOpportunities.map(opportunity => (
                    <OpportunityLink
                      key={opportunity.id}
                      opportunity={opportunity}
                      match={matches.find(item => item.opportunityId === opportunity.id)}
                      fallbackUrl={business.website}
                    />
                  ))}
                  {(business.evidence || []).slice(0, 3).map(item => (
                    <a key={`${item.url}-${item.label}`} style={styles.evidence} href={item.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showReport && (
        <div style={sx('reportOverlay')} role="dialog" aria-modal="true" aria-label="Scout report">
          <div style={sx('reportShell')}>
            <div style={sx('reportHeader')}>
              <div>
                <div style={styles.eyebrow}>Scout report</div>
                <div style={sx('reportTitle')}>Ranked neighborhood report</div>
              </div>
              <button
                type="button"
                style={styles.reportCloseButton}
                onClick={() => setReportDismissedRunId(scout.run?.id)}
              >
                Close
              </button>
            </div>

            <div style={sx('reportStats')}>
              <div style={styles.reportStat}><strong>{businesses.length}</strong><span>places</span></div>
              <div style={styles.reportStat}><strong>{visitedCount}</strong><span>visited</span></div>
              <div style={styles.reportStat}><strong>{strongCount}</strong><span>signals</span></div>
              <div style={styles.reportStat}><strong>{highFitBusinesses.length}</strong><span>top fits</span></div>
            </div>

            <div style={styles.reportSummary}>{scout.summary}</div>

            {highFitBusinesses.length > 0 && interestSubmittedRunId !== scout.run?.id && (
              <div style={styles.reportInterest}>
                <div>
                  <div style={styles.reportSectionTitle}>Notify top-fit businesses</div>
                  <div style={styles.reportCopy}>
                    Send interest to businesses scoring {INTEREST_THRESHOLD}% or higher.
                  </div>
                </div>
                <div style={styles.reportInterestList}>
                  {highFitBusinesses.map(business => (
                    <div key={business.id} style={styles.reportInterestItem}>
                      <span>{business.name}</span>
                      <strong>{business.fitScore}%</strong>
                    </div>
                  ))}
                </div>
                <div style={sx('reportInterestActions')}>
                  <input
                    id="interest-email"
                    style={styles.reportInput}
                    type="email"
                    value={interestEmail}
                    onChange={e => setInterestEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                  <button
                    type="button"
                    style={styles.reportPrimaryButton}
                    onClick={handleSubmitInterest}
                    disabled={interestSubmitting}
                  >
                    {interestSubmitting ? 'Notifying...' : 'Notify businesses'}
                  </button>
                </div>
                {interestError && <div style={styles.interestError}>{interestError}</div>}
              </div>
            )}

            {complete && interestSubmittedRunId === scout.run?.id && (
              <div style={styles.reportDone}>
                {interestDoneMessage}
              </div>
            )}

            <div style={styles.reportSectionTitle}>Ranked businesses</div>
            <div style={sx('reportGrid')}>
              {decidedBusinesses.filter(business => business.inspectionStatus !== 'skipped').map(business => {
                const matchSignals = validMatchSignals(business.matchSignals);
                return (
                  <button
                    key={business.id}
                    type="button"
                    style={styles.reportBusiness}
                    onClick={() => {
                      onSelectBusiness(business);
                      setReportDismissedRunId(scout.run?.id);
                    }}
                  >
                    <div style={styles.reportBusinessHeader}>
                      <span>{business.name}</span>
                      <strong>{business.fitScore ?? '--'}%</strong>
                    </div>
                    <div style={styles.reportBusinessMeta}>{business.vicinity}</div>
                    <div style={styles.reportBusinessReason}>{business.fitReason || business.signalSummary || 'No summary available.'}</div>
                    {matchSignals.slice(0, 3).map(signalItem => (
                      <div key={`${business.id}:${signalItem.weight}:${signalItem.label}`} style={{ ...styles.reportSignal, ...matchSignalStyle(signalItem.weight) }}>
                        {matchSignalPrefix(signalItem.weight)} {signalItem.label}
                      </div>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Inspection step modal */}
      {scout.currentInspectionBusiness && scout.inspectionSteps.length > 0 && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 105,
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: '24px',
            maxWidth: '400px',
            width: '90%',
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div>
              <h3 style={{
                fontSize: 16,
                fontWeight: 700,
                color: '#182033',
                margin: '0 0 8px 0',
              }}>
                Inspecting
              </h3>
              <p style={{
                fontSize: 14,
                color: '#4d5665',
                margin: 0,
                lineHeight: 1.4,
              }}>
                {scout.currentInspectionBusiness.name}
              </p>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: '200px',
            }}>
              {scout.inspectionSteps.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    fontSize: 13,
                    color: '#4d5665',
                  }}
                >
                  <span style={{
                    color: '#36d399',
                    fontWeight: 700,
                    marginTop: 2,
                  }}>✓</span>
                  <span>{step}</span>
                </div>
              ))}
              {/* Pulsing indicator for current step */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: '#8b8173',
                }}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#b56d2a',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                <span>Working...</span>
              </div>
            </div>

            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(0.8); }
              }
            `}</style>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function OpportunityLink({ opportunity, match, fallbackUrl }) {
  return (
    <a
      style={styles.opportunity}
      href={opportunity.url || fallbackUrl}
      target="_blank"
      rel="noreferrer"
      onClick={e => e.stopPropagation()}
    >
      <span>{opportunity.title}</span>
      {match && <span style={styles.opportunityScore}>{match.fitScore}</span>}
    </a>
  );
}

const styles = {
  setupOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: 'rgba(24, 32, 51, 0.72)',
    padding: 24,
    overflow: 'auto',
  },
  setupShell: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#f7f8f5',
    borderRadius: 8,
    color: '#182033',
    padding: 26,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    minHeight: 'calc(100dvh - 48px)',
  },
  setupHeader2: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  setupCloseButton: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#6f5f4c',
    padding: '10px 12px',
    font: 'inherit',
    fontSize: 16,
    fontWeight: 400,
    cursor: 'pointer',
    flexShrink: 0,
  },
  scoutOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: 'rgba(24, 32, 51, 0.72)',
    padding: 24,
    overflow: 'auto',
  },
  scoutShell: {
    maxWidth: 820,
    margin: '0 auto',
    background: '#f7f8f5',
    borderRadius: 8,
    color: '#182033',
    padding: 26,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minHeight: 'calc(100dvh - 48px)',
  },
  scoutHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 12,
  },
  scoutCloseButton: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#6f5f4c',
    padding: '10px 12px',
    font: 'inherit',
    fontSize: 16,
    fontWeight: 400,
    cursor: 'pointer',
    flexShrink: 0,
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    background: '#f7f8f5',
    color: '#182033',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  setupContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: '30px 28px',
    gap: 22,
    overflow: 'auto',
    background: '#f7f8f5',
    color: '#182033',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  recruiterMark: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#6f5f4c',
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
  },
  recruiterRule: {
    width: 36,
    height: 2,
    background: '#b56d2a',
    display: 'inline-block',
  },
  setupHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  setupTitle: {
    color: '#182033',
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 34,
    fontWeight: 800,
    lineHeight: 1.05,
  },
  stepCounter: {
    border: '1px solid #d9d3c9',
    borderRadius: 999,
    color: '#6f5f4c',
    background: '#ffffff',
    padding: '7px 11px',
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
  },
  progressTrack: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 8,
  },
  progressStep: {
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    background: '#ffffff',
    color: '#8b8173',
    padding: '10px 6px',
    font: 'inherit',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
  },
  progressStepActive: {
    color: '#182033',
    background: '#f0e6dc',
    borderColor: '#b56d2a',
  },
  setupStage: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    minHeight: 350,
  },
  stageCopy: {
    color: '#4d5665',
    fontSize: 15,
    lineHeight: 1.65,
    maxWidth: 520,
  },
  pinReadout: {
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    color: '#182033',
    padding: 18,
    fontSize: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    boxShadow: '0 12px 34px rgba(24, 32, 51, 0.07)',
  },
  readoutLabel: {
    color: '#8b8173',
    fontSize: 11,
    fontWeight: 800,
    textTransform: 'uppercase',
  },
  marketNotes: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  marketNote: {
    borderTop: '2px solid #b56d2a',
    background: '#ffffff',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: '#4d5665',
    fontSize: 12,
    lineHeight: 1.45,
  },
  marketNoteTitle: {
    color: '#182033',
  },
  setupTextarea: {
    minHeight: 280,
    resize: 'vertical',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    color: '#182033',
    padding: 16,
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.6,
    outline: 'none',
    boxShadow: '0 12px 34px rgba(24, 32, 51, 0.07)',
  },
  setupLaneGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  setupLaneButton: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    color: '#4d5665',
    padding: '14px 12px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'left',
  },
  setupLaneButtonActive: {
    background: '#182033',
    borderColor: '#182033',
    color: '#ffffff',
  },
  reviewRows: {
    borderTop: '1px solid #d9d3c9',
    background: '#ffffff',
    borderRadius: 6,
    padding: '0 16px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 12px 34px rgba(24, 32, 51, 0.07)',
  },
  reviewRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottom: '1px solid #ece5dc',
    padding: '14px 0',
    color: '#6f5f4c',
    fontSize: 13,
    lineHeight: 1.4,
  },
  inlineSelect: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#182033',
    padding: '7px 9px',
    font: 'inherit',
    fontSize: 12,
  },
  setupActions: {
    display: 'flex',
    gap: 10,
    marginTop: 'auto',
  },
  primarySetupButton: {
    flex: 1,
    background: '#182033',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    padding: '14px 16px',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
  backButton: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#6f5f4c',
    padding: '14px 16px',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
  controls: {
    padding: 18,
    borderBottom: '1px solid #d9d3c9',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    background: '#f7f8f5',
  },
  runHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: '#8b8173',
    fontSize: 10,
    fontWeight: 800,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  runTitle: {
    color: '#182033',
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.1,
  },
  runPill: {
    color: '#182033',
    background: '#f0e6dc',
    border: '1px solid #d9d3c9',
    borderRadius: 999,
    padding: '4px 9px',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  stepRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 6,
  },
  step: {
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#8b8173',
    background: '#ffffff',
    padding: '5px 6px',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: 700,
  },
  stepDone: {
    color: '#182033',
    borderColor: '#b56d2a',
    background: '#f0e6dc',
  },
  textarea: {
    minHeight: 150,
    resize: 'vertical',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    color: '#182033',
    padding: 12,
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.45,
    outline: 'none',
  },
  input: {
    width: '100%',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    color: '#182033',
    padding: '9px 10px',
    font: 'inherit',
    fontSize: 12,
    outline: 'none',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 7 },
  fieldLabel: { color: '#6f5f4c', fontSize: 11, fontWeight: 800 },
  laneGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  laneButton: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#4d5665',
    padding: '5px 7px',
    font: 'inherit',
    fontSize: 10,
    cursor: 'pointer',
  },
  laneButtonActive: {
    background: '#182033',
    borderColor: '#182033',
    color: '#ffffff',
  },
  controlRow: { display: 'flex', gap: 8 },
  select: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#182033',
    padding: '8px 10px',
    font: 'inherit',
    fontSize: 13,
  },
  button: {
    flex: 1,
    background: '#182033',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    padding: '8px 12px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  hint: { fontSize: 11, color: '#8b8173', lineHeight: 1.4 },
  notice: {
    padding: 10,
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    color: '#6f5f4c',
    background: '#ffffff',
    fontSize: 10,
    lineHeight: 1.45,
  },
  error: { fontSize: 12, color: '#b42318' },
  deleteButton: {
    alignSelf: 'flex-start',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#8b8173',
    padding: '6px 9px',
    font: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: 6,
    padding: '10px 14px',
    borderBottom: '1px solid #d9d3c9',
    background: '#ffffff',
    color: '#6f5f4c',
    fontSize: 10,
    textAlign: 'center',
  },
  reportLauncher: {
    margin: 12,
    padding: 14,
    border: '1px solid #d9d3c9',
    borderLeft: '3px solid #18794e',
    borderRadius: 6,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reportLauncherTitle: { color: '#182033', fontSize: 13, fontWeight: 800 },
  reportLauncherMeta: { color: '#6f5f4c', fontSize: 11, marginTop: 3 },
  reportLauncherButton: {
    background: '#182033',
    border: 'none',
    borderRadius: 4,
    color: '#ffffff',
    padding: '8px 10px',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    flexShrink: 0,
  },
  list: { overflowY: 'auto', flex: 1, padding: '10px 12px 16px', background: '#f7f8f5' },
  queueSection: {
    marginBottom: 14,
    paddingBottom: 4,
    borderBottom: '1px solid #d9d3c9',
  },
  queueSectionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    margin: '2px 2px 10px',
  },
  queueTitle: {
    color: '#182033',
    fontSize: 15,
    fontWeight: 800,
    lineHeight: 1.2,
  },
  queueCount: {
    color: '#6f5f4c',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 800,
    flexShrink: 0,
  },
  queueCards: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 10,
  },
  queueCard: {
    padding: 14,
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(24, 32, 51, 0.06)',
  },
  queueCardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  queueRank: {
    width: 26,
    height: 26,
    borderRadius: 4,
    background: '#f0e6dc',
    color: '#6f5f4c',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
  },
  queueCardTitleBlock: { flex: 1, minWidth: 0 },
  queueCardTitle: { color: '#182033', fontSize: 14, fontWeight: 800, lineHeight: 1.3 },
  queueCardMeta: { color: '#4d5665', fontSize: 11, lineHeight: 1.35, marginTop: 3 },
  queueBand: {
    borderRadius: 4,
    padding: '3px 7px',
    fontSize: 10,
    fontWeight: 800,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  queueBandStrong: { background: '#e5f4ec', color: '#18794e' },
  queueBandMedium: { background: '#fff4d6', color: '#936d10' },
  queueBandLow: { background: '#f0e6dc', color: '#6f5f4c' },
  queueVicinity: { color: '#6f5f4c', fontSize: 12, lineHeight: 1.35, marginTop: 9 },
  queueWhy: {
    color: '#182033',
    background: '#f7f8f5',
    border: '1px solid #ece5dc',
    borderRadius: 4,
    padding: '7px 8px',
    fontSize: 12,
    lineHeight: 1.4,
    marginTop: 10,
  },
  queueWebsite: {
    display: 'inline-block',
    color: '#255e91',
    fontSize: 12,
    fontWeight: 800,
    textDecoration: 'none',
    marginTop: 9,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  queueActions: { display: 'flex', gap: 8, marginTop: 12 },
  queueVisitButton: {
    flex: 1,
    background: '#182033',
    border: 'none',
    borderRadius: 4,
    color: '#ffffff',
    padding: '9px 11px',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
  queueSkipButton: {
    flex: 1,
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#6f5f4c',
    padding: '9px 11px',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
  empty: {
    margin: 10,
    padding: 24,
    color: '#6f5f4c',
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1.5,
    textAlign: 'center',
  },
  card: {
    padding: 14,
    marginBottom: 10,
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    background: '#ffffff',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(24, 32, 51, 0.06)',
  },
  cardSelected: { borderColor: '#b56d2a', boxShadow: '0 12px 32px rgba(181, 109, 42, 0.16)' },
  cardHeader: { display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 },
  title: { flex: 1, color: '#182033', fontSize: 14, fontWeight: 800, lineHeight: 1.3 },
  badge: { flexShrink: 0, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 },
  badgeStrong: { background: '#e5f4ec', color: '#18794e' },
  badgeWeak: { background: '#e6eef7', color: '#255e91' },
  badgeFailed: { background: '#fee4e2', color: '#b42318' },
  badgeChecking: { background: '#fff4d6', color: '#936d10' },
  badgeMuted: { background: '#f0e6dc', color: '#6f5f4c' },
  meta: { color: '#6f5f4c', fontSize: 12, lineHeight: 1.35, marginBottom: 8 },
  placeMeta: { color: '#4d5665', fontSize: 11, lineHeight: 1.35, marginBottom: 6 },
  companyBlurb: {
    color: '#182033',
    fontSize: 12,
    lineHeight: 1.4,
    marginBottom: 8,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  companyBlurbMuted: {
    color: '#8b8173',
    fontSize: 12,
    lineHeight: 1.4,
    marginBottom: 8,
  },
  profileToggle: {
    background: 'transparent',
    border: 'none',
    color: '#255e91',
    padding: 0,
    margin: '0 0 8px 0',
    font: 'inherit',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
    textAlign: 'left',
  },
  companyProfile: {
    borderTop: '1px solid #ece5dc',
    borderBottom: '1px solid #ece5dc',
    padding: '9px 0',
    marginBottom: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  profileFacts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    color: '#4d5665',
    fontSize: 11,
    lineHeight: 1.35,
    textTransform: 'capitalize',
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  serviceChip: {
    background: '#e6eef7',
    color: '#255e91',
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 10,
    fontWeight: 700,
  },
  signalChip: {
    background: '#e5f4ec',
    color: '#18794e',
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 10,
    fontWeight: 700,
  },
  hoursList: {
    color: '#6f5f4c',
    fontSize: 10,
    lineHeight: 1.45,
  },
  scoreRow: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  score: { width: 38, color: '#18794e', fontSize: 22, fontWeight: 800, lineHeight: 1 },
  reason: { flex: 1, color: '#4d5665', fontSize: 12, lineHeight: 1.45 },
  matchSignals: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 },
  matchSignalItem: { fontSize: 12, lineHeight: 1.35 },
  matchSignalPositive: { color: '#18794e' },
  matchSignalNeutral: { color: '#936d10' },
  matchSignalNegative: { color: '#6f5f4c' },
  matchSummary: { marginTop: 6, color: '#6f5f4c', fontSize: 11, lineHeight: 1.45, fontStyle: 'italic' },
  details: { marginTop: 12, paddingTop: 12, borderTop: '1px solid #ece5dc', display: 'flex', flexDirection: 'column', gap: 8 },
  link: { color: '#255e91', fontSize: 12, fontWeight: 800, textDecoration: 'none' },
  nextStep: { color: '#182033', fontSize: 12, lineHeight: 1.45 },
  opportunity: {
    color: '#18794e',
    fontSize: 12,
    textDecoration: 'none',
    lineHeight: 1.35,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
  },
  opportunityScore: { color: '#6f5f4c', flexShrink: 0 },
  evidence: { color: '#8b8173', fontSize: 11, textDecoration: 'none', lineHeight: 1.35 },
  nextStop: {
    margin: 12,
    padding: 18,
    border: '1px solid #d9d3c9',
    borderTop: '3px solid #b56d2a',
    borderRadius: 6,
    background: '#ffffff',
    boxShadow: '0 12px 34px rgba(24, 32, 51, 0.08)',
  },
  nextStopLabel: { fontSize: 11, color: '#8b8173', marginBottom: 8, textTransform: 'uppercase', fontWeight: 800 },
  nextStopQueueMeta: {
    color: '#6f5f4c',
    background: '#f7f8f5',
    border: '1px solid #ece5dc',
    borderRadius: 4,
    display: 'inline-flex',
    padding: '4px 7px',
    fontSize: 11,
    fontWeight: 800,
    marginBottom: 10,
  },
  nextStopName: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 24,
    color: '#182033',
    fontWeight: 800,
    lineHeight: 1.1,
    marginBottom: 4,
  },
  nextStopCategory: { fontSize: 12, color: '#b56d2a', marginBottom: 8, fontWeight: 800 },
  nextStopMeta: { fontSize: 13, color: '#4d5665', marginBottom: 8 },
  nextStopWebsite: { fontSize: 12, color: '#255e91', marginBottom: 14 },
  nextStopActions: { display: 'flex', gap: 8 },
  visitButton: {
    flex: 1,
    background: '#182033',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    padding: '10px 12px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  skipButton: {
    flex: 1,
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#6f5f4c',
    padding: '10px 12px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  checking: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    color: '#4d5665',
    fontSize: 12,
  },
  checkingDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#b56d2a',
    animation: 'pulse 1.5s infinite',
  },
  allDonePrompt: {
    padding: 12,
    background: '#e5f4ec',
    borderLeft: '3px solid #18794e',
    color: '#182033',
    fontSize: 12,
    borderBottom: '1px solid var(--border)',
  },
  reportOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 100,
    background: 'rgba(24, 32, 51, 0.72)',
    padding: 24,
    overflow: 'auto',
  },
  reportShell: {
    minHeight: 'calc(100dvh - 48px)',
    maxWidth: 1180,
    margin: '0 auto',
    background: '#f7f8f5',
    border: '1px solid #d9d3c9',
    borderRadius: 8,
    color: '#182033',
    padding: 26,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    boxShadow: '0 30px 90px rgba(0,0,0,0.35)',
  },
  reportHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  reportTitle: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 38,
    fontWeight: 800,
    lineHeight: 1.05,
  },
  reportCloseButton: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#6f5f4c',
    padding: '10px 12px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  reportStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 10,
  },
  reportStat: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  reportSummary: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    padding: 18,
    color: '#182033',
    fontSize: 16,
    lineHeight: 1.7,
  },
  reportInterest: {
    background: '#ffffff',
    border: '1px solid #b7dfcc',
    borderLeft: '3px solid #18794e',
    borderRadius: 6,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  reportSectionTitle: { color: '#182033', fontSize: 15, fontWeight: 800 },
  reportCopy: { color: '#6f5f4c', fontSize: 13, marginTop: 4 },
  reportInterestList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
  },
  reportInterestItem: {
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    padding: '9px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: 13,
  },
  reportInterestActions: { display: 'flex', gap: 10 },
  reportInput: {
    flex: 1,
    minWidth: 0,
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 4,
    color: '#182033',
    padding: '10px 11px',
    font: 'inherit',
    fontSize: 13,
    outline: 'none',
  },
  reportPrimaryButton: {
    background: '#182033',
    border: 'none',
    borderRadius: 4,
    color: '#ffffff',
    padding: '10px 14px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    flexShrink: 0,
  },
  reportDone: {
    padding: 14,
    border: '1px solid #b7dfcc',
    borderRadius: 6,
    background: '#e5f4ec',
    color: '#0f5132',
    fontSize: 13,
  },
  reportGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 12,
  },
  reportBusiness: {
    background: '#ffffff',
    border: '1px solid #d9d3c9',
    borderRadius: 6,
    padding: 14,
    color: '#182033',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  reportBusinessHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    color: '#182033',
    fontSize: 15,
    fontWeight: 800,
  },
  reportBusinessMeta: { color: '#6f5f4c', fontSize: 12, lineHeight: 1.4, marginTop: 5 },
  reportBusinessReason: { color: '#4d5665', fontSize: 13, lineHeight: 1.45, marginTop: 10 },
  reportSignal: { fontSize: 12, lineHeight: 1.35, marginTop: 6 },
  interestPanel: {
    margin: '0 12px 10px',
    padding: 12,
    border: '1px solid #d9d3c9',
    borderLeft: '3px solid #18794e',
    borderRadius: 6,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  interestTitle: { fontSize: 13, fontWeight: 700, color: '#182033' },
  interestList: { display: 'flex', flexDirection: 'column', gap: 6 },
  interestItem: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#4d5665' },
  interestScore: { color: '#18794e', fontWeight: 700 },
  interestLabel: { fontSize: 12, color: '#4d5665' },
  interestError: { color: '#b42318', fontSize: 12 },
  interestDone: {
    margin: '0 12px 10px',
    padding: 12,
    border: '1px solid #b7dfcc',
    borderRadius: 6,
    background: '#e5f4ec',
    color: '#0f5132',
    fontSize: 12,
  },
  cardSkipped: { opacity: 0.6 },
};

const mobileStyles = {
  setupOverlay: {
    padding: 0,
  },
  setupShell: {
    minHeight: '100dvh',
    maxWidth: 'none',
    borderRadius: 0,
    padding: '18px 14px',
    gap: 14,
  },
  setupHeader2: {
    gap: 12,
  },
  setupTitle: {
    fontSize: 28,
  },
  stageCopy: {
    maxWidth: 'none',
    fontSize: 14,
    lineHeight: 1.5,
  },
  progressTrack: {
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 6,
  },
  setupStage: {
    minHeight: 0,
    gap: 14,
  },
  marketNotes: {
    gridTemplateColumns: '1fr',
  },
  setupTextarea: {
    minHeight: 240,
    fontSize: 14,
  },
  setupLaneGrid: {
    gridTemplateColumns: '1fr',
  },
  reviewRow: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 6,
  },
  setupActions: {
    position: 'sticky',
    bottom: 0,
    margin: '0 -14px -18px',
    padding: '12px 14px calc(12px + env(safe-area-inset-bottom))',
    background: '#f7f8f5',
    borderTop: '1px solid #d9d3c9',
  },
  scoutOverlay: {
    padding: 0,
  },
  scoutShell: {
    minHeight: '100dvh',
    maxWidth: 'none',
    borderRadius: 0,
    padding: '16px 12px',
    gap: 10,
  },
  scoutHeader: {
    gap: 12,
    marginBottom: 4,
  },
  runTitle: {
    fontSize: 20,
  },
  controls: {
    margin: '0 -12px',
    padding: '14px 12px',
  },
  stepRow: {
    gap: 5,
  },
  textarea: {
    minHeight: 132,
    fontSize: 14,
  },
  laneGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 7,
  },
  controlRow: {
    flexDirection: 'column',
  },
  stats: {
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    rowGap: 8,
  },
  nextStop: {
    margin: '10px 0',
    padding: 14,
  },
  nextStopActions: {
    position: 'sticky',
    bottom: 0,
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  reportLauncher: {
    margin: '10px 0',
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  list: {
    margin: '0 -12px',
    padding: '10px 12px 88px',
  },
  queueSectionHeader: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 8,
  },
  queueCardHeader: {
    flexWrap: 'wrap',
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'column',
    gap: 6,
  },
  scoreRow: {
    gap: 10,
  },
  reportOverlay: {
    padding: 0,
  },
  reportShell: {
    minHeight: '100dvh',
    maxWidth: 'none',
    borderRadius: 0,
    border: 'none',
    padding: '18px 14px',
  },
  reportHeader: {
    gap: 12,
  },
  reportTitle: {
    fontSize: 30,
  },
  reportStats: {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  reportInterestActions: {
    flexDirection: 'column',
  },
  reportGrid: {
    gridTemplateColumns: '1fr',
  },
};
