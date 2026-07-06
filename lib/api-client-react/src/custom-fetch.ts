export class ApiError extends Error {
  status: number;
  statusText: string;
  data: unknown;
  headers: Headers;

  constructor(status: number, statusText: string, data: unknown, headers: Headers) {
    super(`API error ${status}: ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.data = data;
    this.headers = headers;
  }
}

export const customFetch = async <T>(url: string, options: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json().catch(() => undefined) : await response.blob();

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, data, response.headers);
  }

  return data as T;
};

export default customFetch;
