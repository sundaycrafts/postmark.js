import {ClientOptions, HttpClient} from "./models";
import {ErrorHandler, PostmarkError} from "./errors";

type Result<D, E extends Error = Error> = { success: false, error: E } | { success: true, data: D }

class WebFetch {
    private readonly baseURL: string;
    private readonly timeout: number;
    private readonly validateStatus: (status: number) => boolean;

    constructor({baseURL, timeout, validateStatus}: {
        baseURL: string,
        timeout: number,
        responseType: "json",
        validateStatus: (status: number) => boolean
    }) {
        this.baseURL = baseURL;
        this.timeout = timeout;
        this.validateStatus = validateStatus;
    }

    public async request<D>({method, params, url: path, data, headers}: {
        url: string,
        method: ClientOptions.HttpMethod,
        data: object | null,
        headers: Headers,
        params: Record<string, any>
    }): Promise<Result<D, PostmarkError>> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeout);

        headers.append('Content-Type', "application/json");

        try {
            const url = this.addSearchParams(new URL(path, this.baseURL), params);
            const response = await fetch(`${url.href}`, {
                method,
                headers,
                signal: controller.signal
            })
            clearTimeout(id);

            const data = await response.json();

            if (!this.validateStatus(response.status)) {
                return {
                    success: false,
                    error: new PostmarkError("Request failed", typeof data.ErrorCode === "number" && data.ErrorCode, response.status)
                }
            }

            return {
                success: true,
                data: data.data as D
            }
        } catch (error) {
            /**
             * When abort() is called, the fetch() promise rejects with a DOMException named AbortError.
             * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortController
             */
            return {
                success: false,
                error: new PostmarkError((error as Error).message)
            }
        }
    }

    private addSearchParams(url: URL, params: Record<string, any>) {
        return new URL(
            `${url.origin}${url.pathname}?${new URLSearchParams([
                ...Array.from(Object.entries(url.searchParams)),
                ...Object.entries(params),
            ])}`
        );
    }
}


export class WebFetchHTTPClient extends HttpClient {
    public client!: WebFetch;
    private errorHandler: ErrorHandler;

    public constructor(configOptions?: ClientOptions.Configuration) {
        super(configOptions);
        this.errorHandler = new ErrorHandler();
    }

    /**
     * Create http client instance with default settings.
     *
     * @return {void}
     */
    public initHttpClient(configOptions?: ClientOptions.Configuration): void {
        this.clientOptions = {...HttpClient.DefaultOptions, ...configOptions};

        this.client = new WebFetch({
            baseURL: this.getBaseHttpRequestURL(),
            timeout: this.getRequestTimeoutInMilliseconds(),
            responseType: "json",
            validateStatus(status: number) {
                return status >= 200 && status < 300;
            },
        });
    }

    /**
     * Process http request.
     *
     * @param method - Which type of http request will be executed.
     * @param path - API URL endpoint.
     * @param queryParameters - Querystring parameters used for http request.
     * @param body - Data sent with http request.
     * @param requestHeaders
     */
    public async httpRequest<T>(method: ClientOptions.HttpMethod, path: string, queryParameters: ({} | object),
                                body: (null | object), requestHeaders: Headers): Promise<T> {

        const res = await this.client.request<T>({
            method,
            url: path,
            data: body,
            headers: requestHeaders,
            params: queryParameters,
        })

        if (res.success) {
            return res.data;
        } else {
            throw res.error;
        }
    }

    /**
     * Timeout in seconds is adjusted to Axios format.
     *
     * @private
     */
    private getRequestTimeoutInMilliseconds(): number {
        return (this.clientOptions.timeout || 60) * 1000;
    }
}
