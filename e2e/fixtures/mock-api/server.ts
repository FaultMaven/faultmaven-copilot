import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import type { paths } from '@faultmaven/copilot-ui/types/api.generated';
import {
    authConfig,
    capabilities,
    caseCreate,
    caseMessages,
    casesList,
    caseUi,
    oauthToken,
    sessionCreateFor,
    turnResponse,
    userMe,
} from './fixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8091;

// The extension makes credentialed requests (`credentials: 'include'`). A
// browser REJECTS a wildcard `Access-Control-Allow-Origin: *` for credentialed
// requests ("must not be the wildcard '*' when the request's credentials mode is
// 'include'"), which failed every /cases and /turns call with net::ERR_FAILED and
// surfaced as an "Unexpected Error" in the UI. Reflect the caller's Origin and
// send `Access-Control-Allow-Credentials: true` so credentialed CORS passes.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve static HTML fixtures for testing injection rules on localhost
app.use('/pages', express.static(path.join(__dirname, '../target-pages')));

// Memory store for dynamic behavior across tests.
//
// ‼ This is the ONLY mutable state shared between tests: the browser context is
// test-scoped (fresh profile per test), but this process lives for the whole
// run. A test that sets a flag and dies before clearing it hands the flag to the
// next test. The shared fixture resets it before every test (where it cannot be
// skipped) and reads it back through `GET /__admin/state` to measure rather
// than assume.
const DEFAULT_STATE = {
    shouldFail: false,
    rateLimit: false,
    authExpired: false,
    responseDelayMs: 0,
};
let testState = { ...DEFAULT_STATE };

/**
 * Requests no route answered since the last reset, as `METHOD /path`, once each.
 *
 * Every one is a route the client calls and this mock does not serve, which
 * means the test exercised the client's 404 fallback instead of the path it
 * meant to (#343: capabilities and /auth/me had been 404ing on every run). The
 * shared fixture reads this after each test and fails the test on any entry,
 * naming the route.
 */
let unmatched: string[] = [];

// Admin endpoint for tests to change server state
app.post('/__admin/state', (req, res) => {
    testState = { ...testState, ...req.body };
    res.json(testState);
});

// Read the current state, so a test can assert what it starts from
app.get('/__admin/state', (req, res) => {
    res.json(testState);
});

app.get('/__admin/unmatched', (req, res) => {
    res.json(unmatched);
});

// Reset state
app.post('/__admin/reset', (req, res) => {
    testState = { ...DEFAULT_STATE };
    unmatched = [];
    res.json({ success: true });
});

// Middleware to simulate errors based on state
app.use((req, res, next) => {
    if (req.path.startsWith('/__admin')) return next();

    if (testState.rateLimit) {
        res.set('Retry-After', '60');
        return res.status(429).json({ detail: 'Rate limit exceeded' });
    }
    if (testState.authExpired) {
        return res.status(401).json({ code: 'SESSION_EXPIRED', detail: 'Session expired' });
    }
    if (testState.shouldFail) {
        return res.status(500).json({ detail: 'Internal Server Error' });
    }
    next();
});

// ---------------------------------------------------------------------------
// API routes, registered through `serve`, which takes the path AS THE CONTRACT
// SPELLS IT and the body the contract declares for that status. A route the
// contract drops, or a body that no longer matches its schema, fails
// `pnpm compile`; a route the client calls that nobody registered here fails
// the test that called it (`unmatched`, above).
// ---------------------------------------------------------------------------

type Method = 'get' | 'post' | 'put' | 'delete' | 'patch';

/** The JSON body `paths[P][M]` declares for `status`. */
type JsonBody<P extends keyof paths, M extends keyof paths[P], S extends number> =
    paths[P][M] extends { responses: infer R }
        ? S extends keyof R
            ? R[S] extends { content: { 'application/json': infer B } } ? B : never
            : never
        : never;

function serve<P extends keyof paths, M extends Method & keyof paths[P], S extends number>(
    method: M,
    route: P,
    status: S,
    body: (req: express.Request) => JsonBody<P, M, S>,
): void {
    // `/api/v1/cases/{case_id}/ui` -> express's `/api/v1/cases/:case_id/ui`
    const expressPath = (route as string).replace(/\{(\w+)\}/g, ':$1');
    app[method](expressPath, (req, res) => {
        res.status(status).json(body(req));
    });
}

// Every panel, at boot.
serve('get', '/api/v1/meta/capabilities', 200, () => capabilities);
serve('get', '/api/v1/auth/config', 200, () => authConfig);
serve('get', '/api/v1/auth/me', 200, () => userMe);
serve('post', '/api/v1/sessions', 201, (req) => sessionCreateFor(req.get('authorization')));
serve('post', '/api/v1/auth/oauth/token', 200, () => oauthToken);

// Cases.
serve('get', '/api/v1/cases', 200, () => casesList);
serve('post', '/api/v1/cases', 201, () => caseCreate);
serve('get', '/api/v1/cases/{case_id}/ui', 200, (req) => caseUi(String(req.params.case_id)));
serve('get', '/api/v1/cases/{case_id}/messages', 200, () => caseMessages);
// A turn is held by `responseDelayMs`, so a spec can watch the in-flight indicator.
app.post('/api/v1/cases/:case_id/turns', async (req, res, next) => {
    if (testState.responseDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, testState.responseDelayMs));
    }
    next();
});
serve('post', '/api/v1/cases/{case_id}/turns', 200, () => turnResponse);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Nothing above answered. Record it for the fixture, and 404 as before.
// `/favicon.ico` is the browser's own request for the static /pages fixtures,
// not the client's.
app.use((req, res) => {
    const request = `${req.method} ${req.path}`;
    if (req.path !== '/favicon.ico' && !unmatched.includes(request)) {
        unmatched.push(request);
    }
    res.status(404).json({ detail: `The e2e mock API does not serve ${req.method} ${req.path}` });
});

app.listen(port, () => {
    console.log(`Mock API server running at http://localhost:${port}`);
});
