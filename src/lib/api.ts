const AUTH_TOKEN_KEY = "st_manager_token";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<T>;
  }
  return {} as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return request<T>(url);
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const headers = body instanceof FormData ? undefined : { "Content-Type": "application/json" };
  const payload = body instanceof FormData ? body : JSON.stringify(body ?? {});
  return request<T>(url, {
    method: "POST",
    headers,
    body: payload as BodyInit
  });
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, { method: "DELETE" });
}

export async function downloadZip(url: string, body: unknown, filename: string): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function readError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      detail?: string;
    };
    return body.error ?? body.message ?? body.detail ?? `Request failed: ${response.status}`;
  }
  const text = await response.text();
  return text || `Request failed: ${response.status}`;
}
