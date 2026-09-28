import "server-only";

import { cookies, headers as nextHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Me } from "./types";

// Server-side client for the Go API. The browser never sees the session
// token: it lives in an httpOnly cookie and is sent to Go as a bearer header
// from server components and server actions only.

export const SESSION_COOKIE = "dogfood_session";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8081";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Options = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const token = opts.token === undefined ? await sessionToken() : opts.token;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Pass on the client address Go stamped on the incoming request, so rate
  // limits and vote-abuse rules see the real client, not this server. Go only
  // trusts it because the request comes from this frontend's address.
  const incoming = await nextHeaders();
  const xff = incoming.get("x-forwarded-for");
  if (xff) headers["X-Forwarded-For"] = xff;
  const ua = incoming.get("user-agent");
  if (ua) headers["User-Agent"] = ua;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? "error",
      err.message ?? res.statusText,
    );
  }
  return data as T;
}

/** Raw text fetch, for endpoints outside /api/v1 (e.g. /.well-known). */
export async function apiRoot<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, "error", res.statusText);
  return (await res.json()) as T;
}

/** The signed-in user and their roles, once per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  if (!(await sessionToken())) return null;
  try {
    return await api<Me>("/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});

export async function requireMe(next: string): Promise<Me> {
  const me = await getMe();
  if (!me) redirect(`/login?next=${encodeURIComponent(next)}`);
  return me;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Loads a resource for a page. Unauthenticated requests are sent to the
 * login page; other errors are returned so the page can explain them.
 */
export async function load<T>(path: string, next: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await api<T>(path) };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) redirect(`/login?next=${encodeURIComponent(next)}`);
      if (e.status === 404) notFound();
      // 403s render as an explanation (with HTTP 200): the API has already
      // refused the data, and Next's forbidden() is still experimental.
      return { ok: false, error: e };
    }
    throw e;
  }
}

export function rolesIn(me: Me | null, eventId: string) {
  const roles = new Set(me?.roles?.[eventId] ?? []);
  return {
    organizer: roles.has("organizer"),
    judge: roles.has("judge"),
    participant: roles.has("participant"),
  };
}
