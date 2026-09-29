import type { ReactNode } from "react";
import type { State } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { PhaseTimeline } from "@/components/settings/phase-timeline";
import { Field, inputCls } from "@/components/ui";
import { inputTime } from "@/lib/format";
import type { Event } from "@/lib/types";

type Action = (s: State, fd: FormData) => Promise<State>;

function Group({
  n,
  title,
  desc,
  children,
}: {
  n: string;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="border-t border-line pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="sr-only">{title}</legend>
      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-8">
        <div aria-hidden="true">
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-accent tabular">
              {n}
            </span>
            <span className="text-sm font-semibold">{title}</span>
          </p>
          {desc && (
            <p className="mt-1 text-xs leading-relaxed text-muted">{desc}</p>
          )}
        </div>
        <div className="grid min-w-0 gap-4">{children}</div>
      </div>
    </fieldset>
  );
}

/** Shared by "New event" and "Settings". Dates are entered and shown in UTC. */
export function EventForm({
  action,
  event,
  defaults,
}: {
  action: Action;
  event?: Event;
  defaults?: { open: string; close: string };
}) {
  return (
    <ActionForm action={action} className="grid gap-6">
      {event && <input type="hidden" name="event" value={event.id} />}

      <Group
        n="01"
        title="Identity"
        desc="How the event appears in lists, links and certificates."
      >
        <Field label="Name">
          <input
            name="name"
            maxLength={120}
            required
            defaultValue={event?.name}
            className={inputCls}
          />
        </Field>
        <Field
          label="Slug"
          hint="Used in URLs. Leave empty to derive it from the name."
        >
          <div className="flex items-stretch overflow-hidden rounded-md border border-line-strong bg-surface-2 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15 has-[[aria-invalid=true]]:border-bad/70">
            <span className="flex items-center border-r border-line-strong bg-sunken px-3 font-mono text-xs text-muted">
              /events/
            </span>
            <input
              name="slug"
              pattern="[a-z0-9][a-z0-9-]{1,62}"
              title="Use 2 to 63 lowercase letters, numbers and dashes, starting with a letter or number."
              defaultValue={event?.slug}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-muted/80"
            />
          </div>
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            rows={3}
            defaultValue={event?.description}
            className={inputCls}
          />
        </Field>
      </Group>

      <Group
        n="02"
        title="Timeline"
        desc="All times are UTC. Judging starts when submissions close."
      >
        <PhaseTimeline
          now={new Date().toISOString()}
          initial={{
            submissions_open_at: event
              ? inputTime(event.submissions_open_at)
              : (defaults?.open ?? ""),
            submissions_close_at: event
              ? inputTime(event.submissions_close_at)
              : (defaults?.close ?? ""),
            judging_close_at: inputTime(event?.judging_close_at),
            voting_open_at: inputTime(event?.voting_open_at),
            voting_close_at: inputTime(event?.voting_close_at),
          }}
        />
      </Group>

      <Group
        n="03"
        title="Capacities"
        desc="Limits the engine and the database enforce."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Reviews per project">
            <input
              type="number"
              name="reviews_per_project"
              min={1}
              max={20}
              defaultValue={event?.reviews_per_project ?? 3}
              className={`${inputCls} font-mono tabular`}
            />
          </Field>
          <Field label="Max team size">
            <input
              type="number"
              name="max_team_size"
              min={1}
              max={50}
              defaultValue={event?.max_team_size ?? 4}
              className={`${inputCls} font-mono tabular`}
            />
          </Field>
          <Field label="Votes per voter">
            <input
              type="number"
              name="votes_per_voter"
              min={1}
              max={50}
              defaultValue={event?.votes_per_voter ?? 3}
              className={`${inputCls} font-mono tabular`}
            />
          </Field>
        </div>
      </Group>

      {!event && (
        <Group
          n="04"
          title="Structure"
          desc="You can add more tracks and criteria later in settings."
        >
          <Field label="Tracks" hint="One per line.">
            <textarea name="tracks" rows={3} className={inputCls} />
          </Field>
          <Field
            label="Judging criteria"
            hint="One per line, equal weight; defaults to Functionality, Quality, Innovation."
          >
            <textarea name="criteria" rows={3} className={inputCls} />
          </Field>
        </Group>
      )}

      <Group n={event ? "04" : "05"} title="Visibility">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-surface-2 px-3.5 py-3 transition-colors hover:border-muted/50 has-[:checked]:border-accent/40 has-[:checked]:bg-accent/[0.05]">
          <input
            type="checkbox"
            name="is_public"
            defaultChecked={event?.is_public ?? true}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">Public</span>
            <span className="block text-xs text-muted">
              Listed, with the gallery visible to visitors.
            </span>
          </span>
        </label>
      </Group>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Submit variant={event ? "primary" : "accent"}>
          {event ? "Save" : "Create event"}
        </Submit>
        {event && (
          <p className="text-xs text-muted">
            Every change, including the old and new deadline, is written to the
            audit log.
          </p>
        )}
      </div>
    </ActionForm>
  );
}
