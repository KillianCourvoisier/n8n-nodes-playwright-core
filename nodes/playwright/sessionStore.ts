import type { Browser, BrowserContext, Page } from 'playwright-core';

type PlaywrightModule = typeof import('playwright-core');

interface IStoredSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
}

const sessions = new Map<string, IStoredSession>();

export function getSessionKey(
    workflowId: string | undefined,
    executionId: string | undefined,
    itemIndex: number,
    sessionId?: string,
): string {
    const trimmedSessionId = sessionId?.trim();

    if (trimmedSessionId) {
        return trimmedSessionId;
    }

    return `${workflowId ?? 'unknown-workflow'}:${executionId ?? 'unknown-execution'}:${itemIndex}`;
}

export async function getOrCreateSession(
    playwright: PlaywrightModule,
    sessionKey: string,
    browserlessEndpoint: string,
    timeout: number,
): Promise<IStoredSession> {
    const existingSession = sessions.get(sessionKey);

    if (existingSession && isSessionUsable(existingSession)) {
        existingSession.page = await ensurePage(existingSession.browser, existingSession.context, existingSession.page);
        return existingSession;
    }

    if (existingSession) {
        sessions.delete(sessionKey);
    }

    const browser = await playwright.chromium.connectOverCDP(browserlessEndpoint, {
        timeout,
    });

    browser.on('disconnected', () => {
        sessions.delete(sessionKey);
    });

    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    const session: IStoredSession = {
        browser,
        context,
        page,
    };

    sessions.set(sessionKey, session);

    return session;
}

export async function closeSession(sessionKey: string): Promise<boolean> {
    const session = sessions.get(sessionKey);

    if (!session) {
        return false;
    }

    sessions.delete(sessionKey);

    try {
        await session.browser.close();
    } catch {
        return false;
    }

    return true;
}

function isSessionUsable(session: IStoredSession): boolean {
    const browserIsConnected =
        typeof session.browser.isConnected === 'function' ? session.browser.isConnected() : true;

    const contextIsClosed =
        typeof (session.context as BrowserContext & { isClosed?: () => boolean }).isClosed === 'function'
            ? (session.context as BrowserContext & { isClosed: () => boolean }).isClosed()
            : false;

    return browserIsConnected && !contextIsClosed;
}

async function ensurePage(
    browser: Browser,
    context: BrowserContext,
    page: Page,
): Promise<Page> {
    if (!page.isClosed()) {
        return page;
    }

    const freshContext = browser.contexts()[0] || context || (await browser.newContext());
    const existingPage = freshContext.pages()[0];

    if (existingPage && !existingPage.isClosed()) {
        return existingPage;
    }

    return freshContext.newPage();
}
