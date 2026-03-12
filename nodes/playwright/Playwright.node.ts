import {
    INodeType,
    INodeExecutionData,
    IExecuteFunctions,
    INodeTypeDescription,
    NodeOperationError,
} from 'n8n-workflow';
import { handleOperation } from './operations';
import { runCustomScript } from './customScript';
import { IBrowserOptions } from './types';
import { closeSession, getOrCreateSession, getSessionKey } from './sessionStore';

type ExecutionFunctionsWithExecutionId = IExecuteFunctions & {
    getExecutionId?: () => string;
};

export class Playwright implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Playwright',
        name: 'playwright',
        icon: 'file:playwright.svg',
        group: ['automation'],
        version: 1,
        subtitle: '={{$parameter["operation"]}}',
        description: 'Automate browser actions using Playwright',
        defaults: {
            name: 'Playwright',
        },
        inputs: ['main'],
        outputs: ['main'],

        properties: [
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Click Element',
                        value: 'clickElement',
                        description: 'Click on an element',
                        action: 'Click on an element',
                    },
                    {
                        name: 'Close Session',
                        value: 'closeSession',
                        description: 'Close the current browser session',
                        action: 'Close the current browser session',
                    },
                    {
                        name: 'Fill Form',
                        value: 'fillForm',
                        description: 'Fill a form field',
                        action: 'Fill a form field',
                    },
                    {
                        name: 'Get Text',
                        value: 'getText',
                        description: 'Get text from an element',
                        action: 'Get text from an element',
                    },
                    {
                        name: 'Navigate',
                        value: 'navigate',
                        description: 'Navigate to a URL',
                        action: 'Navigate to a URL',
                    },
                    {
                        name: 'Run Custom Script',
                        value: 'runCustomScript',
                        description: 'Execute custom JavaScript code with full Playwright API access',
                        action: 'Run custom java script code',
                    },
                    {
                        name: 'Take Screenshot',
                        value: 'takeScreenshot',
                        description: 'Take a screenshot of the current page',
                        action: 'Take a screenshot of the current page',
                    },
                ],
                default: 'navigate',
            },

            {
                displayName: 'URL',
                name: 'url',
                type: 'string',
                default: '',
                placeholder: 'https://example.com',
                description: 'The URL to navigate to',
                displayOptions: {
                    show: {
                        operation: ['navigate'],
                    },
                },
                required: true,
            },

            {
                displayName: 'Session ID',
                name: 'sessionId',
                type: 'string',
                default: '',
                placeholder: 'optional-shared-session',
                description:
                    'Optional custom session ID. Leave empty to auto-share one session per workflow execution and item index.',
                displayOptions: {
                    hide: {
                        operation: ['closeSession'],
                    },
                },
            },

            {
                displayName: 'Leave Session Open',
                name: 'leaveSessionOpen',
                type: 'boolean',
                default: true,
                description: 'Whether to keep the browser session open for the next Playwright node',
                displayOptions: {
                    hide: {
                        operation: ['closeSession'],
                    },
                },
            },

            {
                displayName: 'Script Code',
                name: 'scriptCode',
                type: 'string',
                typeOptions: {
                    editor: 'codeNodeEditor',
                    editorLanguage: 'javaScript',
                },
                required: true,
                default: `const title = await $page.title();

return [{
    json: {
        title,
        url: $page.url()
    }
}];`,
                description:
                    'JavaScript code to execute with Playwright. Access $page, $browser, $playwright, and all n8n Code node variables.',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operation: ['runCustomScript'],
                    },
                },
            },

            {
                displayName:
                    'Use <code>$page</code>, <code>$browser</code>, or <code>$playwright</code> to access Playwright. <a target="_blank" href="https://docs.n8n.io/code-examples/methods-variables-reference/">Special vars/methods</a> are available. <br><br>Debug by using <code>console.log()</code> statements and viewing their output in the browser console.',
                name: 'notice',
                type: 'notice',
                displayOptions: {
                    show: {
                        operation: ['runCustomScript'],
                    },
                },
                default: '',
            },

            {
                displayName: 'Property Name',
                name: 'dataPropertyName',
                type: 'string',
                required: true,
                default: 'screenshot',
                description: 'Name of the binary property in which to store the screenshot data',
                displayOptions: {
                    show: {
                        operation: ['takeScreenshot'],
                    },
                },
            },

            {
                displayName: 'Selector Type',
                name: 'selectorType',
                type: 'options',
                options: [
                    {
                        name: 'CSS Selector',
                        value: 'css',
                        description: 'Use CSS selector (e.g., #submit-button, .my-class)',
                    },
                    {
                        name: 'XPath',
                        value: 'xpath',
                        description: 'Use XPath expression (e.g., //button[@ID="submit"])',
                    },
                ],
                default: 'css',
                description: 'Choose between CSS selector or XPath',
                displayOptions: {
                    show: {
                        operation: ['getText', 'clickElement', 'fillForm'],
                    },
                },
            },

            {
                displayName: 'CSS Selector',
                name: 'selector',
                type: 'string',
                default: '',
                placeholder: '#submit-button',
                description: 'CSS selector for the element (e.g., #ID, .class, button[type="submit"])',
                displayOptions: {
                    show: {
                        operation: ['getText', 'clickElement', 'fillForm'],
                        selectorType: ['css'],
                    },
                },
                required: true,
            },

            {
                displayName: 'XPath',
                name: 'xpath',
                type: 'string',
                default: '',
                placeholder: '//button[@ID="submit"]',
                description:
                    'XPath expression for the element (e.g., //div[@class="content"], //button[text()="Click Me"])',
                displayOptions: {
                    show: {
                        operation: ['getText', 'clickElement', 'fillForm'],
                        selectorType: ['xpath'],
                    },
                },
                required: true,
            },

            {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                description: 'Value to fill in the form field',
                displayOptions: {
                    show: {
                        operation: ['fillForm'],
                    },
                },
                required: true,
            },

            {
                displayName: 'Browserless Endpoint',
                name: 'browserlessEndpoint',
                type: 'string',
                default: 'http://browserless:3000',
                placeholder: 'http://browserless:3000',
                required: true,
                description: 'Browserless CDP endpoint used when a new session is created',
                displayOptions: {
                    hide: {
                        operation: ['closeSession'],
                    },
                },
            },

            {
                displayName: 'Browser Connection Options',
                name: 'browserOptions',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                displayOptions: {
                    hide: {
                        operation: ['closeSession'],
                    },
                },
                options: [
                    {
                        displayName: 'Timeout',
                        name: 'timeout',
                        type: 'number',
                        default: 30000,
                        description: 'Connection timeout in milliseconds',
                    },
                ],
            },

            {
                displayName: 'Screenshot Options',
                name: 'screenshotOptions',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                displayOptions: {
                    show: {
                        operation: ['takeScreenshot'],
                    },
                },
                options: [
                    {
                        displayName: 'Full Page',
                        name: 'fullPage',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to take a screenshot of the full scrollable page',
                    },
                    {
                        displayName: 'Path',
                        name: 'path',
                        type: 'string',
                        default: '',
                        description: 'The file path to save the screenshot to',
                    },
                ],
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const executionId = (this as ExecutionFunctionsWithExecutionId).getExecutionId?.();
        const workflowId = this.getWorkflow().id;

        for (let i = 0; i < items.length; i++) {
            const operation = this.getNodeParameter('operation', i) as string;
            const sessionId = this.getNodeParameter('sessionId', i, '') as string;
            const sessionKey = getSessionKey(workflowId, executionId, i, sessionId);

            try {
                if (operation === 'closeSession') {
                    const closed = await closeSession(sessionKey);

                    returnData.push({
                        json: {
                            success: closed,
                            sessionKey,
                            message: closed ? 'Session closed' : 'No session found',
                        },
                        pairedItem: {
                            item: i,
                        },
                    });

                    continue;
                }

                const leaveSessionOpen = this.getNodeParameter('leaveSessionOpen', i, true) as boolean;
                const browserlessEndpoint = this.getNodeParameter('browserlessEndpoint', i) as string;
                const browserOptions = this.getNodeParameter('browserOptions', i) as IBrowserOptions;
                const playwright = require('playwright-core');

                if (!browserlessEndpoint) {
                    throw new NodeOperationError(this.getNode(), 'Browserless endpoint is required', {
                        itemIndex: i,
                    });
                }

                const session = await getOrCreateSession(
                    playwright,
                    sessionKey,
                    browserlessEndpoint,
                    browserOptions.timeout || 30000,
                );

                if (operation === 'navigate') {
                    const url = this.getNodeParameter('url', i) as string;
                    await session.page.goto(url);
                }

                let result: INodeExecutionData | INodeExecutionData[];

                if (operation === 'runCustomScript') {
                    result = await runCustomScript(this, i, session.browser, session.page, playwright);
                    returnData.push(...result);
                } else {
                    result = await handleOperation(operation, session.page, this, i);
                    returnData.push(result);
                }

                if (!leaveSessionOpen) {
                    await closeSession(sessionKey);
                }
            } catch (error: any) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: error.message,
                            sessionKey,
                        },
                        pairedItem: {
                            item: i,
                        },
                    });
                    continue;
                }

                throw error;
            }
        }

        return [returnData];
    }
}
