import { test, expect, seedExtensionStorage, signedInStorage, MOCK_API } from '../setup/extension-context';

/**
 * A request the panel builds for one user is never sent with another user's
 * credential (copilot#350).
 *
 * Another user (B) signing in on the same browser profile, through the
 * Dashboard bridge for example, lands in storage a moment before the panel
 * hears of it. Measured on the bridge path: 7–58 ms from the storage write to
 * the panel's reload (median about 18 ms over 10 runs). In that window the
 * panel still builds requests for A. The credential read used to hand out
 * whatever was stored, so a `POST /cases` carrying A's first message would
 * create A's content in B's account.
 *
 * The window is held open here on purpose: B's session is written straight
 * into storage, without the sign-in broadcast that ends it. Then the panel is
 * told, as the bridge would tell it, and it moves to B normally.
 */
const B_USER = { user_id: 'e2e-user-b', username: 'other_user', roles: ['user'] };

test.describe('A request carries the user it was built for', () => {
    test("an A-built POST /cases after B's sign-in is not sent, and B's session survives", async ({ context, extensionId }) => {
        await seedExtensionStorage(context, signedInStorage());

        const panel = await context.newPage();
        const caseCreates: string[] = [];
        panel.on('request', (request) => {
            if (request.method() === 'POST' && request.url() === `${MOCK_API}/api/v1/cases`) {
                caseCreates.push(request.headers()['authorization'] ?? '');
            }
        });
        await panel.goto(`chrome-extension://${extensionId}/sidepanel_manual.html`);
        await expect(panel.getByText(/New Case/i).first()).toBeVisible();

        // B signs in: storage only, the broadcast not yet delivered.
        const expiresAt = Date.now() + 3_600_000;
        await seedExtensionStorage(context, {
            access_token: 'b-access-token',
            token_type: 'bearer',
            expires_at: expiresAt,
            refresh_token: 'b-refresh-token',
            user: B_USER,
            authState: { access_token: 'b-access-token', token_type: 'bearer', expires_at: expiresAt, user: B_USER },
        });

        // A, still on screen, starts a new case.
        await panel.getByText(/New Case/i).first().click();
        const input = panel.locator('textarea').first();
        await expect(input).toBeEnabled();
        await input.fill("A's first message");

        // Whichever comes first — the create going out, or the panel saying why
        // it did not — then the cause before the symptom. Armed before the click,
        // since the create goes out within it.
        const notice = panel.getByText(/Another account signed in on this browser/).first();
        const firstOutcome = Promise.race([
            panel.waitForRequest((r) => r.method() === 'POST' && r.url() === `${MOCK_API}/api/v1/cases`),
            notice.waitFor(),
        ]);
        await panel.getByRole('button', { name: 'Send' }).click();
        await firstOutcome;
        expect(caseCreates).toEqual([]);
        await expect(notice).toBeVisible();

        // Nothing was torn down: B's session is exactly as B's sign-in wrote it.
        const options = await context.newPage();
        await options.goto(`chrome-extension://${extensionId}/options.html`);
        const stored = await options.evaluate(async () => {
            const s = await chrome.storage.local.get(['access_token', 'refresh_token', 'authState']);
            return {
                access: s.access_token ?? null,
                refresh: s.refresh_token ?? null,
                user: (s.authState as { user?: { user_id?: string } } | undefined)?.user?.user_id ?? null,
            };
        });
        expect(stored).toEqual({ access: 'b-access-token', refresh: 'b-refresh-token', user: B_USER.user_id });

        // The sign-in's broadcast arrives; the panel moves to B, signed in.
        const reloaded = panel.waitForEvent('load');
        await options.evaluate((user) => chrome.runtime.sendMessage({
            type: 'auth_state_changed',
            authState: { isAuthenticated: true, user },
        }), B_USER);
        await reloaded;
        await expect(panel.getByText(/New Case/i).first()).toBeVisible();
        await expect(panel.getByText('Sign in to get started')).toHaveCount(0);
    });
});
