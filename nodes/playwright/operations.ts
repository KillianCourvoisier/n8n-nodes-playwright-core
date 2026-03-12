import { IExecuteFunctions, INodeExecutionData, NodeOperationError } from 'n8n-workflow';
import { Download, Page, Response } from 'playwright-core';

function getActionLocator(executeFunctions: IExecuteFunctions, itemIndex: number, page: Page) {
    const selectorType = executeFunctions.getNodeParameter('selectorType', itemIndex) as string;
    const selector =
        selectorType === 'css'
            ? (executeFunctions.getNodeParameter('selector', itemIndex) as string)
            : (executeFunctions.getNodeParameter('xpath', itemIndex) as string);

    const locator =
        selectorType === 'css' ? page.locator(selector).first() : page.locator(`xpath=${selector}`).first();

    return { selectorType, selector, locator };
}

async function safely<T>(promise: Promise<T>): Promise<T | null> {
    try {
        return await promise;
    } catch {
        return null;
    }
}

function looksLikeDownloadResponse(response: Response): boolean {
    const headers = response.headers();
    const contentDisposition = headers['content-disposition'] || '';
    const contentType = headers['content-type'] || '';
    const url = response.url().toLowerCase();

    return (
        contentDisposition.toLowerCase().includes('attachment') ||
        contentDisposition.toLowerCase().includes('filename=') ||
        contentType.toLowerCase().includes('application/pdf') ||
        contentType.toLowerCase().includes('application/octet-stream') ||
        url.endsWith('.pdf')
    );
}

function filenameFromDisposition(contentDisposition: string): string | null {
    const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        try {
            return decodeURIComponent(utf8Match[1]);
        } catch {
            return utf8Match[1];
        }
    }

    const plainMatch =
        contentDisposition.match(/filename\s*=\s*"([^"]+)"/i) ||
        contentDisposition.match(/filename\s*=\s*([^;]+)/i);

    return plainMatch?.[1]?.trim() || null;
}

function filenameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
        return lastSegment || 'download';
    } catch {
        return 'download';
    }
}

function resolveUrl(url: string, baseUrl: string): string {
    try {
        return new URL(url, baseUrl).toString();
    } catch {
        return url;
    }
}

function isViewerLikeUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();

    return (
        lowerUrl.startsWith('chrome-extension://') ||
        lowerUrl.startsWith('about:blank') ||
        lowerUrl.startsWith('blob:')
    );
}

async function prepareBinaryFromBuffer(
    executeFunctions: IExecuteFunctions,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    return executeFunctions.helpers.prepareBinaryData(buffer, fileName, mimeType);
}

async function prepareBinaryFromDownload(
    executeFunctions: IExecuteFunctions,
    download: Download,
) {
    const suggestedFilename = download.suggestedFilename() || 'download';
    const failure = await download.failure();

    if (failure) {
        throw new Error(`Download failed: ${failure}`);
    }

    const stream = await download.createReadStream();

    if (!stream) {
        throw new Error('Unable to read downloaded file stream');
    }

    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    const mimeType = suggestedFilename.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/octet-stream';

    return {
        binaryData: await prepareBinaryFromBuffer(executeFunctions, buffer, suggestedFilename, mimeType),
        fileName: suggestedFilename,
        mimeType,
        size: buffer.length,
    };
}

async function prepareBinaryFromResponse(
    executeFunctions: IExecuteFunctions,
    response: Response,
) {
    const headers = response.headers();
    const contentDisposition = headers['content-disposition'] || '';
    const mimeType = headers['content-type']?.split(';')[0]?.trim() || 'application/octet-stream';
    const fileName = filenameFromDisposition(contentDisposition) || filenameFromUrl(response.url());
    const body = await response.body();

    return {
        binaryData: await prepareBinaryFromBuffer(executeFunctions, Buffer.from(body), fileName, mimeType),
        fileName,
        mimeType,
        size: body.length,
        url: response.url(),
        status: response.status(),
    };
}

async function fetchFileFromUrl(
    executeFunctions: IExecuteFunctions,
    page: Page,
    url: string,
    fallbackFileName?: string,
) {
    const response = await page.context().request.get(url);

    if (!response.ok()) {
        throw new Error(`Failed to fetch file from URL: ${url} (${response.status()})`);
    }

    const headers = response.headers();
    const contentDisposition = headers['content-disposition'] || '';
    const contentType = headers['content-type']?.split(';')[0]?.trim() || 'application/octet-stream';
    const body = await response.body();

    const fileName =
        filenameFromDisposition(contentDisposition) ||
        fallbackFileName ||
        filenameFromUrl(url);

    return {
        binaryData: await prepareBinaryFromBuffer(executeFunctions, Buffer.from(body), fileName, contentType),
        fileName,
        mimeType: contentType,
        size: body.length,
        url,
        status: response.status(),
    };
}

async function fetchFileThroughPage(
    executeFunctions: IExecuteFunctions,
    page: Page,
    url: string,
    fallbackFileName?: string,
) {
    const result = await page.evaluate(async (targetUrl) => {
        const response = await fetch(targetUrl, { credentials: 'include' });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const contentDisposition = response.headers.get('content-disposition') || '';
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        let binary = '';
        const chunkSize = 0x8000;

        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }

        return {
            url: response.url || targetUrl,
            status: response.status,
            mimeType: contentType.split(';')[0]?.trim() || 'application/octet-stream',
            contentDisposition,
            base64: btoa(binary),
            size: bytes.length,
        };
    }, url);

    const fileName =
        filenameFromDisposition(result.contentDisposition) ||
        fallbackFileName ||
        filenameFromUrl(result.url || url);

    return {
        binaryData: await prepareBinaryFromBuffer(
            executeFunctions,
            Buffer.from(result.base64, 'base64'),
            fileName,
            result.mimeType,
        ),
        fileName,
        mimeType: result.mimeType,
        size: result.size,
        url: result.url || url,
        status: result.status,
    };
}

export async function handleOperation(
    operation: string,
    page: Page,
    executeFunctions: IExecuteFunctions,
    itemIndex: number,
): Promise<INodeExecutionData> {
    switch (operation) {
        case 'navigate': {
            const content = await page.content();
            const url = page.url();

            return {
                json: {
                    content,
                    url,
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'takeScreenshot': {
            const screenshotOptions = executeFunctions.getNodeParameter('screenshotOptions', itemIndex);
            const dataPropertyName =
                (executeFunctions.getNodeParameter('dataPropertyName', itemIndex) as string) || 'screenshot';
            const screenshot = await page.screenshot(screenshotOptions as Parameters<Page['screenshot']>[0]);

            const binaryData = await executeFunctions.helpers.prepareBinaryData(
                Buffer.from(screenshot),
                (screenshotOptions as { path?: string }).path || dataPropertyName,
                'image/png',
            );

            return {
                binary: {
                    [dataPropertyName]: binaryData,
                },
                json: {
                    success: true,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'getText': {
            const { selectorType, selector, locator } = getActionLocator(executeFunctions, itemIndex, page);
            const text = await locator.textContent();

            return {
                json: {
                    text,
                    selectorType,
                    selector,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'clickElement': {
            const { selectorType, selector, locator } = getActionLocator(executeFunctions, itemIndex, page);

            await locator.click();

            return {
                json: {
                    success: true,
                    selectorType,
                    selector,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'fillForm': {
            const { selectorType, selector, locator } = getActionLocator(executeFunctions, itemIndex, page);
            const value = executeFunctions.getNodeParameter('value', itemIndex) as string;

            await locator.fill(value);

            return {
                json: {
                    success: true,
                    selectorType,
                    selector,
                    value,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'downloadFile': {
            const { selectorType, selector, locator } = getActionLocator(executeFunctions, itemIndex, page);
            const propertyName =
                (executeFunctions.getNodeParameter('downloadPropertyName', itemIndex) as string) || 'data';
            const downloadOptions = executeFunctions.getNodeParameter('downloadOptions', itemIndex, {}) as {
                clickTimeout?: number;
                waitTimeout?: number;
                preferPopupPage?: boolean;
            };

            const clickTimeout = downloadOptions.clickTimeout || 15000;
            const waitTimeout = downloadOptions.waitTimeout || 15000;
            const preferPopupPage = downloadOptions.preferPopupPage !== false;
            const context = page.context();

            const href = await locator.getAttribute('href').catch(() => null);
            const absoluteHref = href ? resolveUrl(href, page.url()) : null;

            const popupPromise = safely(context.waitForEvent('page', { timeout: waitTimeout }));
            const downloadPromise = safely(page.waitForEvent('download', { timeout: waitTimeout }));
            const responsePromise = safely(
                page.waitForResponse((response) => looksLikeDownloadResponse(response), { timeout: waitTimeout }),
            );
            const navigationPromise = safely(page.waitForNavigation({ timeout: waitTimeout }));

            await locator.click({ timeout: clickTimeout });

            const download = await downloadPromise;

            if (download) {
                const suggestedFileName = download.suggestedFilename() || undefined;

                if (absoluteHref && !absoluteHref.startsWith('javascript:')) {
                    const fetched = await fetchFileFromUrl(
                        executeFunctions,
                        page,
                        absoluteHref,
                        suggestedFileName,
                    );

                    return {
                        binary: {
                            [propertyName]: fetched.binaryData,
                        },
                        json: {
                            success: true,
                            method: 'download-event-fetch-href',
                            selectorType,
                            selector,
                            url: page.url(),
                            downloadUrl: fetched.url,
                            fileName: fetched.fileName,
                            mimeType: fetched.mimeType,
                            size: fetched.size,
                            status: fetched.status,
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    };
                }

                const prepared = await prepareBinaryFromDownload(executeFunctions, download);

                if (prepared.size > 0) {
                    return {
                        binary: {
                            [propertyName]: prepared.binaryData,
                        },
                        json: {
                            success: true,
                            method: 'download-event-stream',
                            selectorType,
                            selector,
                            url: page.url(),
                            fileName: prepared.fileName,
                            mimeType: prepared.mimeType,
                            size: prepared.size,
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    };
                }

                throw new NodeOperationError(
                    executeFunctions.getNode(),
                    'Download event was detected but file content was empty',
                    { itemIndex },
                );
            }

            const popupPage = await popupPromise;
            const navigation = await navigationPromise;
            const directResponse = await responsePromise;

            const candidatePage = preferPopupPage && popupPage ? popupPage : popupPage || page;

            if (absoluteHref && !absoluteHref.startsWith('javascript:')) {
                const fetchedInPage = await safely(
                    fetchFileThroughPage(executeFunctions, page, absoluteHref),
                );

                if (fetchedInPage && fetchedInPage.size > 0) {
                    return {
                        binary: {
                            [propertyName]: fetchedInPage.binaryData,
                        },
                        json: {
                            success: true,
                            method: 'browser-fetch-href',
                            selectorType,
                            selector,
                            pageUrl: page.url(),
                            url: fetchedInPage.url,
                            status: fetchedInPage.status,
                            fileName: fetchedInPage.fileName,
                            mimeType: fetchedInPage.mimeType,
                            size: fetchedInPage.size,
                            navigated: Boolean(navigation),
                            popupOpened: Boolean(popupPage),
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    };
                }

                const fetchedByRequest = await safely(
                    fetchFileFromUrl(executeFunctions, page, absoluteHref),
                );

                if (fetchedByRequest && fetchedByRequest.size > 0) {
                    return {
                        binary: {
                            [propertyName]: fetchedByRequest.binaryData,
                        },
                        json: {
                            success: true,
                            method: 'direct-href-fetch',
                            selectorType,
                            selector,
                            pageUrl: page.url(),
                            url: fetchedByRequest.url,
                            status: fetchedByRequest.status,
                            fileName: fetchedByRequest.fileName,
                            mimeType: fetchedByRequest.mimeType,
                            size: fetchedByRequest.size,
                            navigated: Boolean(navigation),
                            popupOpened: Boolean(popupPage),
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    };
                }
            }

            if (directResponse) {
                const prepared = await prepareBinaryFromResponse(executeFunctions, directResponse);

                return {
                    binary: {
                        [propertyName]: prepared.binaryData,
                    },
                    json: {
                        success: true,
                        method: 'response-capture',
                        selectorType,
                        selector,
                        pageUrl: candidatePage.url(),
                        url: prepared.url,
                        status: prepared.status,
                        fileName: prepared.fileName,
                        mimeType: prepared.mimeType,
                        size: prepared.size,
                        navigated: Boolean(navigation),
                        popupOpened: Boolean(popupPage),
                    },
                    pairedItem: {
                        item: itemIndex,
                    },
                };
            }

            if (popupPage) {
                const popupResponse = await safely(
                    popupPage.waitForResponse((response) => looksLikeDownloadResponse(response), { timeout: waitTimeout }),
                );

                if (popupResponse) {
                    const prepared = await prepareBinaryFromResponse(executeFunctions, popupResponse);

                    try {
                        await popupPage.close();
                    } catch {}

                    return {
                        binary: {
                            [propertyName]: prepared.binaryData,
                        },
                        json: {
                            success: true,
                            method: 'popup-response-capture',
                            selectorType,
                            selector,
                            pageUrl: page.url(),
                            popupUrl: popupPage.url(),
                            url: prepared.url,
                            status: prepared.status,
                            fileName: prepared.fileName,
                            mimeType: prepared.mimeType,
                            size: prepared.size,
                        },
                        pairedItem: {
                            item: itemIndex,
                        },
                    };
                }

                const popupUrl = popupPage.url();

                if (popupUrl && !isViewerLikeUrl(popupUrl)) {
                    const popupFetchResponse = await popupPage.context().request.get(popupUrl);
                    const contentType = popupFetchResponse.headers()['content-type'] || '';
                    const contentDisposition = popupFetchResponse.headers()['content-disposition'] || '';

                    if (
                        popupFetchResponse.ok() &&
                        !contentType.toLowerCase().includes('text/html') &&
                        (contentType.toLowerCase().includes('application/pdf') ||
                            contentDisposition.toLowerCase().includes('attachment') ||
                            popupUrl.toLowerCase().endsWith('.pdf'))
                    ) {
                        const body = await popupFetchResponse.body();
                        const mimeType = contentType.split(';')[0]?.trim() || 'application/octet-stream';
                        const fileName =
                            filenameFromDisposition(contentDisposition) || filenameFromUrl(popupUrl);

                        const binaryData = await prepareBinaryFromBuffer(
                            executeFunctions,
                            Buffer.from(body),
                            fileName,
                            mimeType,
                        );

                        try {
                            await popupPage.close();
                        } catch {}

                        return {
                            binary: {
                                [propertyName]: binaryData,
                            },
                            json: {
                                success: true,
                                method: 'popup-fetch',
                                selectorType,
                                selector,
                                pageUrl: page.url(),
                                popupUrl,
                                fileName,
                                mimeType,
                                size: body.length,
                                status: popupFetchResponse.status(),
                            },
                            pairedItem: {
                                item: itemIndex,
                            },
                        };
                    }
                }
            }

            throw new NodeOperationError(
                executeFunctions.getNode(),
                'No downloadable file was detected after the click',
                { itemIndex },
            );
        }

        default:
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `Unknown operation: ${operation}`,
                { itemIndex },
            );
    }
}
