export type BrowserType = 'chromium' | 'firefox' | 'webkit';

export interface IBrowserOptions {
    headless?: boolean;
    slowMo?: number;
}

export interface IScreenshotOptions {
    fullPage?: boolean;
    path?: string;
}