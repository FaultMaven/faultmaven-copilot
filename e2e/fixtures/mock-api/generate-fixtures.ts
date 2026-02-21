import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outDir = path.join(__dirname, 'responses');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

const fixtures = {
    session_create: {
        session_id: "e2e-session-12345",
        session_resumed: false,
        client_id: "e2e-client-12345",
        message: "Session created successfully"
    },
    auth_token: {
        access_token: "e2e-mock-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "e2e-mock-refresh-token",
        refresh_expires_in: 86400,
        user: {
            user_id: "e2e-user-1",
            username: "e2e_tester",
            email: "tester@faultmaven.ai",
            display_name: "E2E Tester",
            is_dev_user: true,
            roles: ["user", "admin"]
        }
    },
    cases_list: {
        data: [
            {
                id: "case-1",
                title: "E2E Empty Case",
                status: "open",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            },
            {
                id: "case-2",
                title: "E2E Full Case",
                status: "resolved",
                created_at: new Date(Date.now() - 86400000).toISOString(),
                updated_at: new Date(Date.now() - 86400000).toISOString()
            }
        ],
        total: 2,
        page: 1,
        size: 20
    },
    case_create: {
        id: "case-3-new",
        title: "Newly Created Case",
        status: "open",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    },
    case_queries: {
        data: [
            {
                id: "query-1",
                case_id: "case-2",
                role: "user",
                content: "What is the status of the Datadog alert?",
                created_at: new Date(Date.now() - 3600000).toISOString()
            },
            {
                id: "query-2",
                case_id: "case-2",
                role: "assistant",
                content: "The alert indicates high CPU usage on the primary database cluster. I have isolated the nodes experiencing this issue.",
                created_at: new Date(Date.now() - 3500000).toISOString()
            }
        ]
    },
    query_response: {
        id: "query-new-response",
        case_id: "case-1",
        role: "assistant",
        content: "This is a mock response from the API. I can see your query.",
        created_at: new Date().toISOString()
    },
    user_me: {
        user_id: "e2e-user-1",
        username: "e2e_tester",
        email: "tester@faultmaven.ai",
        display_name: "E2E Tester",
        is_dev_user: true,
        roles: ["user", "admin"]
    }
};

for (const [name, data] of Object.entries(fixtures)) {
    fs.writeFileSync(
        path.join(outDir, `${name}.json`),
        JSON.stringify(data, null, 2),
        'utf-8'
    );
}

console.log('Fixtures generated successfully.');
