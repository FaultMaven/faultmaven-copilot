import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8091;

app.use(cors());
app.use(express.json());

// Serve static HTML fixtures for testing injection rules on localhost
app.use('/pages', express.static(path.join(__dirname, '../target-pages')));

// Helper to send a stored fixture
function sendFixture(res: express.Response, fixtureName: string, statusCode = 200) {
    const filePath = path.join(__dirname, 'responses', `${fixtureName}.json`);
    if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        res.status(statusCode).json(data);
    } else {
        // Return a default empty response if fixture not found, or error
        res.status(statusCode).json({ message: `Fixture ${fixtureName} not found` });
    }
}

// Memory store for dynamic behavior across tests
let testState = {
    shouldFail: false,
    rateLimit: false,
    authExpired: false,
};

// Admin endpoint for tests to reset/change server state
app.post('/__admin/state', (req, res) => {
    testState = { ...testState, ...req.body };
    res.json(testState);
});

// Reset state
app.post('/__admin/reset', (req, res) => {
    testState = {
        shouldFail: false,
        rateLimit: false,
        authExpired: false,
    };
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

// API Routes
app.post('/api/v1/sessions', (req, res) => {
    sendFixture(res, 'session_create');
});

app.post('/api/v1/auth/oauth/token', (req, res) => {
    sendFixture(res, 'auth_token');
});

app.get('/api/v1/cases', (req, res) => {
    sendFixture(res, 'cases_list');
});

app.post('/api/v1/cases', (req, res) => {
    sendFixture(res, 'case_create');
});

app.get('/api/v1/cases/:id/queries', (req, res) => {
    sendFixture(res, 'case_queries');
});

app.post('/api/v1/cases/:id/queries', (req, res) => {
    sendFixture(res, 'query_response');
});

app.get('/api/v1/users/me', (req, res) => {
    sendFixture(res, 'user_me');
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`Mock API server running at http://localhost:${port}`);
});
