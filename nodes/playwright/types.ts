export interface IBrowserOptions {
    timeout?: number;
}

export interface IScreenshotOptions {
    fullPage?: boolean;
    path?: string;
}

export interface IDownloadOptions {
    clickTimeout?: number;
    waitTimeout?: number;
    preferPopupPage?: boolean;
}

export type DownloadSource = 'element' | 'url';
