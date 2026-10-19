import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	IPairedItemData,
	IWebhookFunctions,
} from 'n8n-workflow';

export type FakeResponse = { statusCode: number; body: unknown; headers?: IDataObject };

const node: INode = {
	id: 'node-1',
	name: 'miniDesk',
	type: '@minidesk/n8n-nodes-minidesk.miniDesk',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const triggerNode: INode = {
	...node,
	name: 'miniDesk Trigger',
	type: '@minidesk/n8n-nodes-minidesk.miniDeskTrigger',
};

// n8n's own check: a truthy `json` key means the item is already wrapped.
const returnJsonArray = (data: IDataObject | IDataObject[]): INodeExecutionData[] =>
	(Array.isArray(data) ? data : [data]).map((json) =>
		json?.json ? { ...json, json: json.json as IDataObject } : { json },
	);

// `params[name]`, or a dotted path inside a collection; a resource locator gives its value.
function readParameter(
	params: Record<string, unknown>,
	name: string,
	fallback: unknown,
	options?: { extractValue?: boolean },
): unknown {
	const value =
		name in params
			? params[name]
			: name
					.split('.')
					.reduce<unknown>(
						(parent, key) =>
							parent !== null && typeof parent === 'object'
								? (parent as Record<string, unknown>)[key]
								: undefined,
						params,
					);

	if (value === undefined) return fallback;

	if (
		options?.extractValue === true &&
		value !== null &&
		typeof value === 'object' &&
		'mode' in value &&
		'value' in value
	) {
		return (value as { value: unknown }).value;
	}

	return value;
}

// Answers each call with the next response and records what was sent.
function fakeHttp(responses: FakeResponse[]) {
	const queue = [...responses];
	const calls: IHttpRequestOptions[] = [];
	const credentialTypes: string[] = [];

	const httpRequestWithAuthentication = async (
		credentialType: string,
		options: IHttpRequestOptions,
	) => {
		credentialTypes.push(credentialType);
		calls.push(options);

		const next = queue.shift();

		if (next === undefined) {
			throw new Error(`No fake response left for ${options.method} ${options.url}`);
		}

		return { statusCode: next.statusCode, body: next.body, headers: next.headers ?? {} };
	};

	return { calls, credentialTypes, httpRequestWithAuthentication };
}

export function fakeExecuteContext(input: {
	params: Record<string, unknown>;
	responses: FakeResponse[];
	items?: number;
	continueOnFail?: boolean;
	executionId?: string;
	runIndex?: number;
}): { context: IExecuteFunctions; calls: IHttpRequestOptions[]; credentialTypes: string[] } {
	const { calls, credentialTypes, httpRequestWithAuthentication } = fakeHttp(input.responses);
	const runIndex = input.runIndex ?? 0;
	const items: INodeExecutionData[] = Array.from({ length: input.items ?? 1 }, () => ({
		json: {},
	}));

	const context = {
		getNodeParameter: (
			name: string,
			_itemIndex: number,
			fallback?: unknown,
			options?: { extractValue?: boolean },
		) => readParameter(input.params, name, fallback, options),
		getInputData: () => items,
		continueOnFail: () => input.continueOnFail ?? false,
		getExecutionId: () => input.executionId ?? 'exec-1',
		// Like n8n outside AI agent tool calls: no runIndex here, only on the data proxy.
		getExecuteData: () => ({}),
		getWorkflowDataProxy: () => ({ $runIndex: runIndex }),
		getNode: () => node,
		helpers: {
			httpRequestWithAuthentication,
			returnJsonArray,
			constructExecutionMetaData: (
				inputData: INodeExecutionData[],
				options: { itemData: IPairedItemData | IPairedItemData[] },
			) => inputData.map(({ json, ...rest }) => ({ json, pairedItem: options.itemData, ...rest })),
		},
	};

	return { context: context as unknown as IExecuteFunctions, calls, credentialTypes };
}

export function fakeLoadOptionsContext(input: {
	params?: Record<string, unknown>;
	responses: FakeResponse[];
}): { context: ILoadOptionsFunctions; calls: IHttpRequestOptions[]; credentialTypes: string[] } {
	const { calls, credentialTypes, httpRequestWithAuthentication } = fakeHttp(input.responses);
	const params = input.params ?? {};

	const context = {
		getNodeParameter: (name: string, fallback?: unknown, options?: { extractValue?: boolean }) =>
			readParameter(params, name, fallback, options),
		getCurrentNodeParameter: (name: string, options?: { extractValue?: boolean }) =>
			readParameter(params, name, undefined, options),
		getNode: () => node,
		helpers: { httpRequestWithAuthentication },
	};

	return { context: context as unknown as ILoadOptionsFunctions, calls, credentialTypes };
}

export function fakeHookContext(input: {
	params: Record<string, unknown>;
	staticData?: IDataObject;
	webhookUrl?: string;
	responses: FakeResponse[];
}): { context: IHookFunctions; calls: IHttpRequestOptions[]; staticData: IDataObject } {
	const { calls, httpRequestWithAuthentication } = fakeHttp(input.responses);
	// One object for every call, like n8n, so the test sees what the node stored.
	const staticData: IDataObject = { ...input.staticData };

	const context = {
		getNodeParameter: (name: string, fallback?: unknown, options?: { extractValue?: boolean }) =>
			readParameter(input.params, name, fallback, options),
		getNodeWebhookUrl: () => input.webhookUrl ?? 'https://n8n.example.com/webhook/abc',
		getWorkflowStaticData: () => staticData,
		getNode: () => triggerNode,
		helpers: { httpRequestWithAuthentication },
	};

	return { context: context as unknown as IHookFunctions, calls, staticData };
}

export function fakeWebhookContext(input: {
	params: Record<string, unknown>;
	staticData?: IDataObject;
	headers?: Record<string, string | string[] | undefined>;
	rawBody?: unknown;
	body?: IDataObject;
}): { context: IWebhookFunctions; response: { status?: number; sent?: unknown } } {
	const staticData: IDataObject = { ...input.staticData };
	const response: { status?: number; sent?: unknown } = {};

	// The chainable part of an Express response the trigger uses.
	const expressResponse = {
		status: (code: number) => {
			response.status = code;

			return expressResponse;
		},
		send: (payload: unknown) => {
			response.sent = payload;

			return expressResponse;
		},
		end: () => expressResponse,
	};

	const context = {
		getNodeParameter: (name: string, fallback?: unknown, options?: { extractValue?: boolean }) =>
			readParameter(input.params, name, fallback, options),
		getWorkflowStaticData: () => staticData,
		getHeaderData: () => input.headers ?? {},
		getRequestObject: () => ({ rawBody: input.rawBody, body: input.body ?? {} }),
		getBodyData: () => input.body ?? {},
		getResponseObject: () => expressResponse,
		getNode: () => triggerNode,
		helpers: { returnJsonArray },
	};

	return { context: context as unknown as IWebhookFunctions, response };
}
