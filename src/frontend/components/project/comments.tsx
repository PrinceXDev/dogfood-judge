import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { initials } from "@/components/project/identity";
import { Tag } from "@/components/ui";
import { ago, when } from "@/lib/format";
import type { Comment } from "@/lib/types";

export function Comments({
  comments,
  signedIn,
  loginHref,
  form,
}: {
  comments: Comment[];
  signedIn: boolean;
  loginHref: string;
  form: ReactNode;
}) {
  return (
    <section
      id="comments"
      aria-labelledby="comments-h"
      className="mt-12 scroll-mt-24"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2
          id="comments-h"
          className="text-xl font-semibold tracking-[-0.025em]"
        >
          Comments
        </h2>
        <span className="font-mono text-xs text-muted tabular">
          {comments.length}
        </span>
      </div>

      {comments.length ? (
        <ol className="grid gap-1">
          {comments.map((c) => (
            <li
              key={c.id}
              className={`flex gap-3 rounded-lg px-1 py-3 ${c.hidden ? "opacity-60" : ""}`}
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-2 font-mono text-[10.5px] font-medium text-ink-2"
              >
                {initials(c.user_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="font-medium text-ink">{c.user_name}</span>
                  <time
                    dateTime={c.created_at}
                    title={when(c.created_at)}
                    className="font-mono text-[11px] text-muted"
                  >
                    {ago(c.created_at)}
                  </time>
                  {c.hidden && <Tag tone="bad">hidden</Tag>}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
          No comments yet. Be the first to say something kind and specific.
        </p>
      )}

      <div className="mt-5">
        {signedIn ? (
          form
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-4 py-3 text-sm text-ink-2">
            Sign in to join the conversation.
            <Link href={loginHref} className={buttonClass("secondary", "sm")}>
              Sign in to comment
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
