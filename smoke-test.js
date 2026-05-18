#!/usr/bin/env node

const BASE_URL = 'https://hirenear-a7jlfl42zq-uw.a.run.app';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log(`\n🧪 HireNear Smoke Tests (${BASE_URL})\n`);

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Test 1: Health check
test('Health check', async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error('Health check returned ok: false');
});

// Test 2: Runtime config
test('Runtime config injection', async () => {
  const res = await fetch(`${BASE_URL}/runtime-config.js`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const text = await res.text();
  if (!text.includes('window.HIRENEAR_CONFIG')) throw new Error('Missing window.HIRENEAR_CONFIG');
  if (!text.includes('mapboxToken')) throw new Error('Missing mapboxToken in config');
});

// Test 3: Create Scout run
test('Create Scout run', async () => {
  const resumeText = 'Software Engineer with 5 years experience. Skills: JavaScript, React, Node.js. Looking for roles in tech startups.';
  const res = await fetch(`${BASE_URL}/api/scout-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resumeText,
      lat: 40.7608,
      lng: -111.8910,
      radius: 15000,
      locationLabel: 'Salt Lake City, UT',
      targetLanes: ['Software Engineer', 'Frontend Developer'],
    }),
  });
  if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}`);
  const data = await res.json();
  if (!data.runId) throw new Error('No runId in response');
  // Store for next test
  global.testRunId = data.runId;
});

// Test 4: Get Scout run state
test('Get Scout run state', async () => {
  if (!global.testRunId) throw new Error('No runId from previous test');
  const res = await fetch(`${BASE_URL}/api/scout-runs/${global.testRunId}`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const data = await res.json();
  if (!data.run) throw new Error('No run object in response');
  if (!['running', 'complete'].includes(data.run.status)) throw new Error(`Unexpected status: ${data.run.status}`);
});

// Test 5: SSE stream
test('SSE event stream', async () => {
  if (!global.testRunId) throw new Error('No runId from previous test');

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('No SSE event received within 10s'));
    }, 10000);

    const url = `${BASE_URL}/api/scout-runs/${global.testRunId}/events`;
    fetch(url, { signal: controller.signal })
      .then(res => {
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const read = async () => {
          try {
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(timeout);
              reject(new Error('Stream ended without receiving an event'));
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            if (buffer.includes('\n')) {
              clearTimeout(timeout);
              resolve();
              controller.abort();
            } else {
              await read();
            }
          } catch (err) {
            clearTimeout(timeout);
            if (err.name !== 'AbortError') reject(err);
          }
        };

        read();
      })
      .catch(err => {
        clearTimeout(timeout);
        if (err.name !== 'AbortError') reject(err);
      });
  });
});

// Test 6: SearchAPI budget guard
test('SearchAPI blocked (budget guard)', async () => {
  const res = await fetch(`${BASE_URL}/api/jobs?query=manager&location=Salt+Lake+City`);
  // When DAILY_SEARCHAPI_LIMIT=0, budgetGuard throws an error, which returns 500
  // This is correct behavior - the endpoint rejects the request
  if (res.status === 500) return; // Expected - budget guard error
  if (res.status === 503) return; // Also acceptable
  throw new Error(`Expected 500 or 503 (budget blocked), got ${res.status}`);
});

runTests();
