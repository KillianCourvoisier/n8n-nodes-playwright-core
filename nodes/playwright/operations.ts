import { IExecuteFunctions, INodeExecutionData, NodeOperationError } from 'n8n-workflow';
import { Page } from 'playwright-core';

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
            const selectorType = executeFunctions.getNodeParameter('selectorType', itemIndex) as string;
            const textSelector =
                selectorType === 'css'
                    ? (executeFunctions.getNodeParameter('selector', itemIndex) as string)
                    : (executeFunctions.getNodeParameter('xpath', itemIndex) as string);

            const locator =
                selectorType === 'css'
                    ? page.locator(textSelector).first()
                    : page.locator(`xpath=${textSelector}`).first();

            const text = await locator.textContent();

            return {
                json: {
                    text,
                    selectorType,
                    selector: textSelector,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'clickElement': {
            const clickSelectorType = executeFunctions.getNodeParameter('selectorType', itemIndex) as string;
            const clickSelector =
                clickSelectorType === 'css'
                    ? (executeFunctions.getNodeParameter('selector', itemIndex) as string)
                    : (executeFunctions.getNodeParameter('xpath', itemIndex) as string);

            const locator =
                clickSelectorType === 'css'
                    ? page.locator(clickSelector).first()
                    : page.locator(`xpath=${clickSelector}`).first();

            await locator.click();

            return {
                json: {
                    success: true,
                    selectorType: clickSelectorType,
                    selector: clickSelector,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        case 'fillForm': {
            const formSelectorType = executeFunctions.getNodeParameter('selectorType', itemIndex) as string;
            const formSelector =
                formSelectorType === 'css'
                    ? (executeFunctions.getNodeParameter('selector', itemIndex) as string)
                    : (executeFunctions.getNodeParameter('xpath', itemIndex) as string);
            const value = executeFunctions.getNodeParameter('value', itemIndex) as string;

            const locator =
                formSelectorType === 'css'
                    ? page.locator(formSelector).first()
                    : page.locator(`xpath=${formSelector}`).first();

            await locator.fill(value);

            return {
                json: {
                    success: true,
                    selectorType: formSelectorType,
                    selector: formSelector,
                    value,
                    url: page.url(),
                },
                pairedItem: {
                    item: itemIndex,
                },
            };
        }

        default:
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `Unknown operation: ${operation}`,
                { itemIndex },
            );
    }
}
