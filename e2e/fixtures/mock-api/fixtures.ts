/**
 * The mock API's response bodies, typed by the GENERATED contract
 * (packages/copilot-ui/types/api.generated.ts, pinned in api-contract.pin.json).
 *
 * These were JSON files, and they drifted silently: the case list kept a
 * `total`/`page`/`size` envelope the API no longer sends, the token response a
 * `user` object it never sent, the case UI response lacked required fields
 * (#343). A typed module turns the next drift into a `pnpm compile` error: when
 * the contract is adopted and a schema moves, the fixture stops compiling
 * instead of quietly exercising a shape no server produces.
 *
 * `satisfies` checks each body against its schema, extra keys included, while
 * keeping its literal type for the routes that read it.
 */
import type { components } from '@faultmaven/copilot-ui/types/api.generated';
import type { SessionCreateResponse } from '@faultmaven/copilot-ui/lib/session/client-session-manager';

type Schemas = components['schemas'];

/** Fixed, so a fixture never differs between two runs. */
const T0 = '2026-02-20T21:42:36.236Z';
const T_DAY_BEFORE = '2026-02-19T21:42:36.236Z';

/**
 * The account `signedInStorage()` (e2e/setup/extension-context.ts) seeds. The
 * cases below are created by it, so a test signed in as it drives them and
 * the panel opens them writable.
 */
export const E2E_USER_ID = 'e2e-user';

/** `GET /api/v1/meta/capabilities` — read by every panel at boot. */
export const capabilities = {
    deploymentMode: 'self-hosted',
    kbManagement: 'dashboard',
    dashboardUrl: 'http://localhost:3333',
    features: {
        extensionKB: false,
        adminKB: true,
        teamSharing: false,
        caseHistory: true,
        sso: false,
        managementConsole: false,
    },
    limits: {
        maxFileBytes: 10485760,
        allowedExtensions: ['.md', '.txt', '.log', '.json', '.csv'],
        // A usable bound (turn timing accepts 30-1200 s), so the e2e turns run
        // on derived timing rather than the no-capabilities fallback.
        turnCeilingSeconds: 240,
        turnResponseBoundSeconds: 300,
    },
    branding: { name: 'FaultMaven', supportUrl: 'https://faultmaven.ai/support' },
} satisfies Schemas['BackendCapabilities'];

/**
 * `GET /api/v1/auth/config`. OAuth mode, the mode of the Dashboard-bridge
 * sessions the specs seed, so a refresh goes to `/api/v1/auth/oauth/token`,
 * which is mocked (local mode would refresh at `/api/v1/auth/refresh`).
 */
export const authConfig = {
    auth_mode: 'oauth',
    login_endpoint: null,
    register_endpoint: null,
    supports_registration: false,
    oauth: {
        authorize_url: 'http://localhost:3333/auth/authorize',
        token_url: '/api/v1/auth/oauth/token',
        client_id: 'faultmaven-copilot',
        scopes: ['openid', 'profile'],
        self_service_signup_enabled: false,
        supports_screen_hint: false,
        hosted_login_url: null,
    },
} satisfies Schemas['AuthConfigResponse'];

/** `GET /api/v1/auth/me` — the account row's profile. */
export const userMe = {
    user_id: E2E_USER_ID,
    username: 'test_user',
    email: 'tester@faultmaven.ai',
    display_name: 'E2E Tester',
    is_dev_user: true,
    roles: ['user'],
    created_at: T0,
} satisfies Schemas['UserInfoResponse'];

/** `POST /api/v1/auth/oauth/token` — the code exchange and the refresh grant. */
export const oauthToken = {
    access_token: 'e2e-mock-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'e2e-mock-refresh-token',
    refresh_expires_in: 86400,
    user_id: E2E_USER_ID,
    username: 'test_user',
} satisfies Schemas['TokenResponse'];

/**
 * `POST /api/v1/sessions`. The contract leaves this body untyped (`unknown`),
 * so it is held to the shape the client parses instead. Served through
 * `sessionCreateFor`, below.
 */
const sessionCreate = {
    session_id: 'e2e-session-12345',
    user_id: E2E_USER_ID,
    client_id: 'e2e-client-12345',
    status: 'active',
    created_at: T0,
    session_type: 'troubleshooting',
    session_resumed: false,
    message: 'Session created successfully',
} satisfies SessionCreateResponse;

/**
 * The user behind each bearer the harness issues. The client refuses a session
 * minted for anyone but its own user (faultmaven#1460), so the mock mints, as
 * the API does, for the user the presented bearer belongs to.
 */
const BEARER_USERS: Record<string, string> = {
    [oauthToken.access_token]: oauthToken.user_id, // the OAuth code exchange, above
    'e2e-mock-token': E2E_USER_ID, // signedInStorage(), e2e/setup/extension-context.ts
    'e2e-bridge-access-token': 'e2e-bridge-user', // target-pages/dashboard-signed-in.html
    'race-access-token': 'race-user', // 07-sign-in-during-panel-startup
    'b-access-token': 'e2e-user-b', // 08-request-carries-its-user, user B
};

/** What the API mints for no bearer, or one it cannot resolve: an anonymous `user_<8 hex>`. */
const ANONYMOUS_USER_ID = 'user_0000e2e0';

/** `POST /api/v1/sessions` for the request's `Authorization` header. */
export function sessionCreateFor(authorization: string | undefined) {
    const bearer = (authorization ?? '').replace(/^Bearer\s+/i, '');
    return { ...sessionCreate, user_id: BEARER_USERS[bearer] ?? ANONYMOUS_USER_ID };
}

function caseSummary(overrides: Pick<Schemas['CaseSummary'], 'case_id' | 'title'> & Partial<Schemas['CaseSummary']>) {
    return {
        description: '',
        created_at: T0,
        updated_at: T0,
        last_activity_at: T0,
        current_turn: 0,
        turns_without_progress: 0,
        state: 'inquiry',
        stage: null,
        is_terminal: false,
        resolved_at: null,
        closed_at: null,
        closure_reason: null,
        source: 'browser_extension',
        user_id: E2E_USER_ID,
        enterprise_id: 'e2e-enterprise',
        organization_id: null,
        ...overrides,
    } satisfies Schemas['CaseSummary'];
}

/** `GET /api/v1/cases` — the sidebar (`access=write`) and the reconcile read. */
export const casesList = {
    cases: [
        caseSummary({ case_id: 'case-1', title: 'E2E Empty Case' }),
        caseSummary({
            case_id: 'case-2',
            title: 'E2E Full Case',
            created_at: T_DAY_BEFORE,
            updated_at: T_DAY_BEFORE,
            last_activity_at: T_DAY_BEFORE,
            current_turn: 3,
            state: 'resolved',
            is_terminal: true,
            resolved_at: T_DAY_BEFORE,
        }),
    ],
    total_count: 2,
    limit: 100,
    offset: 0,
    has_more: false,
} satisfies Schemas['CaseListResponse'];

/** `POST /api/v1/cases` (201) — the lazy create behind a first message. */
export const caseCreate = caseSummary({ case_id: 'case-3-new', title: 'Newly Created Case' });

/**
 * `GET /api/v1/cases/{case_id}/ui`. `state` is the discriminator of the
 * CaseUIResponse_* union, and the header crashes without it (it drifted once,
 * when the API renamed status -> state, and broke e2e from 2026-06-04 on).
 */
export function caseUi(caseId: string) {
    return {
        case_id: caseId,
        title: 'E2E Test Case',
        state: 'inquiry',
        created_at: T0,
        updated_at: T0,
        current_turn: 0,
        uploaded_files_count: 0,
        inquiry: { inquiry_turns: 0, problem_statement_confirmed: false },
        // The server lists only CLOSED. ``investigating`` stopped being a user
        // action in #1608 and ``resolved`` in contract 9.0.0 — both are earned
        // from case content and offered by the agent through a handshake, and
        // both are refused as requests.
        valid_next_states: ['closed'],
    } satisfies Schemas['CaseUIResponse_Inquiry'];
}

/** `GET /api/v1/cases/{case_id}/messages` — an empty conversation. */
export const caseMessages = {
    messages: [],
    total_count: 0,
    retrieved_count: 0,
    has_more: false,
} satisfies Schemas['CaseMessagesResponse'];

/** `POST /api/v1/cases/{case_id}/turns`. The specs assert on `agent_response`. */
export const turnResponse = {
    agent_response: 'This is a mock response from the API. I can see your query.',
    turn_number: 1,
    milestones_completed: [],
    progress_made: false,
    attachments_processed: [],
    case_state: 'inquiry',
    suggested_actions: [],
} satisfies Schemas['TurnResponse'];
