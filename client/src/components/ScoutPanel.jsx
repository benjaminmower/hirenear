import { useMemo, useState, useCallback, useEffect } from 'react';

const RADII = [
  { label: '500m', value: 500 },
  { label: '1km', value: 1000 },
  { label: '2km', value: 2000 },
  { label: '5km', value: 5000 },
];

const TARGET_LANES = [
  'Finance',
  'Healthcare',
  'Hospitality',
  'Office/Admin',
  'Sales',
  'Retail',
  'Food service',
  'Operations',
  'Customer support',
  'Logistics',
  'Education',
  'Skilled trades',
  'Technology',
  'Marketing',
  'Nonprofit',
  'Beauty/wellness',
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

export default function ScoutPanel({
  scout,
  searchPin,
  radius,
  onRadiusChange,
  onSelectBusiness,
  selectedBusiness,
}) {
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
    businesses.filter(b => b.inspectionStatus === 'queued'),
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
      locationLabel: 'Dropped pin',
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
      <div style={styles.setupContainer}>
        <div style={styles.recruiterMark}>
          <span style={styles.recruiterRule} />
          <span>hirenear.app</span>
        </div>
        <div style={styles.setupHeader}>
          <div>
            <div style={styles.eyebrow}>{stepMeta.eyebrow}</div>
            <div style={styles.setupTitle}>{stepMeta.title}</div>
          </div>
          <div style={styles.stepCounter}>{currentStepIndex + 1} / {SETUP_STEPS.length}</div>
        </div>
        <div style={styles.stageCopy}>{stepMeta.copy}</div>

        <div style={styles.progressTrack}>
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

        <div style={styles.setupStage}>
          {setupStep === 'area' && (
            <>
              <div style={styles.pinReadout}>
                <span style={styles.readoutLabel}>Selected area</span>
                <strong>{searchPin ? 'Dropped pin' : 'Waiting for a pin'}</strong>
                <span>{searchPin ? `${searchPin.lat.toFixed(4)}, ${searchPin.lng.toFixed(4)}` : 'Click the map to set the search center.'}</span>
              </div>
              <div style={styles.marketNotes}>
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
                style={styles.setupTextarea}
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
              <div style={styles.setupLaneGrid}>
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
                <div style={styles.reviewRow}>
                  <span>Area</span>
                  <strong>{searchPin ? 'Dropped pin' : 'Missing pin'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Resume</span>
                  <strong>{resumeReady ? 'Ready' : 'Needs more text'}</strong>
                </div>
                <div style={styles.reviewRow}>
                  <span>Lanes</span>
                  <strong>{targetLanes.length ? targetLanes.join(', ') : 'None selected'}</strong>
                </div>
                <div style={styles.reviewRow}>
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

        <div style={styles.setupActions}>
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
    );
  }

  return (
    <div style={styles.container}>
      {/* Setup controls */}
      <div style={styles.controls}>
        <div style={styles.runHeader}>
          <div>
            <div style={styles.eyebrow}>Scout run</div>
            <div style={styles.runTitle}>{stage}</div>
          </div>
          <div style={styles.runPill}>{searchPin ? `${radius / 1000}km` : 'No pin'}</div>
        </div>
        <div style={styles.stepRow}>
          <span style={{ ...styles.step, ...(searchPin ? styles.stepDone : {}) }}>Pin</span>
          <span style={{ ...styles.step, ...(resumeText.trim().length >= 40 ? styles.stepDone : {}) }}>Resume</span>
          <span style={{ ...styles.step, ...(targetLanes.length > 0 ? styles.stepDone : {}) }}>Lanes</span>
          <span style={{ ...styles.step, ...(hasRun ? styles.stepDone : {}) }}>Walk</span>
        </div>
        <textarea
          style={styles.textarea}
          value={resumeText}
          onChange={e => setResumeText(e.target.value)}
          placeholder="Paste resume text here..."
          disabled={isRunning || isDiscovering}
        />
        <div style={styles.fieldGroup}>
          <div style={styles.fieldLabel}>What kind of work?</div>
          <div style={styles.laneGrid}>
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
        <div style={styles.controlRow}>
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
          {searchPin ? `Pin: ${searchPin.lat.toFixed(4)}, ${searchPin.lng.toFixed(4)}` : 'Click the map to drop a scout pin.'}
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
        <div style={styles.stats}>
          <span>{businesses.length} places</span>
          <span>{queuedBusinesses.length} queued</span>
          <span>{visitedCount} visited</span>
          <span>{skippedCount} skipped</span>
          <span>{strongCount} strong</span>
        </div>
      )}

      {/* Game mechanic: Next Stop card */}
      {isRunning && activeBusiness && (
        <div style={styles.nextStop}>
          <div style={styles.nextStopLabel}>
            {checkingBusiness ? 'Inspecting website' : 'Next stop'}
          </div>
          <div style={styles.nextStopName}>{activeBusiness.name}</div>
          {activeBusiness.category && (
            <div style={styles.nextStopCategory}>{activeBusiness.category}</div>
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
            <div style={styles.nextStopActions}>
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
        <div style={styles.reportLauncher}>
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
      <div style={styles.list}>
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
          return (
            <div
              key={business.id}
              style={{ ...styles.card, ...(selected ? styles.cardSelected : {}), ...(business.inspectionStatus === 'skipped' ? styles.cardSkipped : {}) }}
              onClick={() => onSelectBusiness(selected ? null : business)}
            >
              <div style={styles.cardHeader}>
                <span style={styles.title}>{business.name}</span>
                <span style={{ ...styles.badge, ...signalStyle(signal) }}>
                  {business.inspectionStatus === 'skipped' ? 'Skipped' : signalLabel(signal)}
                </span>
              </div>
              <div style={styles.meta}>{business.vicinity}</div>
              {business.inspectionStatus !== 'skipped' && (
                <>
                  <div style={styles.scoreRow}>
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
        <div style={styles.reportOverlay} role="dialog" aria-modal="true" aria-label="Scout report">
          <div style={styles.reportShell}>
            <div style={styles.reportHeader}>
              <div>
                <div style={styles.eyebrow}>Scout report</div>
                <div style={styles.reportTitle}>Ranked neighborhood report</div>
              </div>
              <button
                type="button"
                style={styles.reportCloseButton}
                onClick={() => setReportDismissedRunId(scout.run?.id)}
              >
                Close
              </button>
            </div>

            <div style={styles.reportStats}>
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
                <div style={styles.reportInterestActions}>
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
            <div style={styles.reportGrid}>
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
