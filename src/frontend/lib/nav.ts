import "server-only";

import { cache } from "react";
import type { NavData } from "@/components/shell/nav-data";
import { api, getMe } from "./api";
import type { Event } from "./types";

/** The viewer's navigation context, once per request. */
export const getNav = cache(async (): Promise<NavData> => {
  const [me, events] = await Promise.all([
    getMe(),
    api<Event[] | null>("/events").catch(() => null),
  ]);
  const list = (events ?? []).map((e) => {
    const roles = new Set(me?.roles?.[e.id] ?? []);
    return {
      id: e.id,
      slug: e.slug,
      name: e.name,
      organizer: roles.has("organizer"),
      judge: roles.has("judge"),
      participant: roles.has("participant"),
      published: !!e.results_published_at,
    };
  });
  return {
    user: me
      ? { name: me.user.name, email: me.user.email, isAdmin: me.user.is_admin }
      : null,
    canCreate: !!me?.can_create_events,
    judge: list.some((e) => e.judge),
    organizer: list.some((e) => e.organizer),
    participant: list.some((e) => e.participant),
    events: list,
  };
});
