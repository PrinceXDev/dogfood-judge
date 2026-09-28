// What the navigation, command palette and dashboard need to know about the
// viewer. Built on the server from /me and /events; holds no secrets (the
// CSRF token and session never leave the server).

export type NavEvent = {
  id: string;
  slug: string;
  name: string;
  organizer: boolean;
  judge: boolean;
  participant: boolean;
  published: boolean;
};

export type NavData = {
  user: { name: string; email: string; isAdmin: boolean } | null;
  canCreate: boolean;
  judge: boolean;
  organizer: boolean;
  participant: boolean;
  events: NavEvent[];
};
