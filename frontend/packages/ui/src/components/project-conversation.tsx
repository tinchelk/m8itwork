"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Message } from "./workspace-types";
import { useFormDraft } from "./workspace-drafts";

interface Page {
  messages: Message[];
  olderCursor: string | null;
}
export function ProjectConversation({
  projectId,
  accountId,
  team,
  onError,
  readOnly = false,
}: {
  projectId: string;
  accountId: string;
  team: boolean;
  onError: (reason: unknown) => void;
  readOnly?: boolean;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const reading = useRef<string | null>(null);
  const draft = useFormDraft(formRef, accountId, `conversation:${projectId}`);
  const prefix = `${team ? "/v1/operator/projects" : "/v1/projects"}/${projectId}/messages`;
  const error = useCallback((reason: unknown) => onError(reason), [onError]);
  const receive = useCallback((result: Page) => {
    setHistory((previous) => [
      ...new Map(
        [...previous, ...result.messages].map((message) => [
          message.id,
          message,
        ]),
      ).values(),
    ]);
    setPage(result);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let fetching = false;
    async function load() {
      if (fetching || document.visibilityState === "hidden") return;
      fetching = true;
      try {
        const result = await api<Page>(prefix);
        if (cancelled) return;
        receive(result);
      } catch (reason) {
        if (!cancelled) error(reason);
      } finally {
        fetching = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15_000);
    const refresh = () => void load();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [prefix, error, receive]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState === "hidden") return;
        const visible = entries
          .filter(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.9,
          )
          .map((entry) => entry.target as HTMLElement)
          .sort((a, b) =>
            (a.dataset.date ?? "").localeCompare(b.dataset.date ?? ""),
          );
        const last = visible.at(-1);
        const date = last?.dataset.date;
        if (
          !last?.dataset.messageId ||
          !date ||
          (reading.current && reading.current >= date)
        )
          return;
        reading.current = date;
        void api(`${prefix}/read`, { messageId: last.dataset.messageId }).catch(
          (reason) => {
            if (reading.current === date) reading.current = null;
            error(reason);
          },
        );
      },
      { threshold: 0.9 },
    );
    listRef.current
      ?.querySelectorAll("[data-message-id]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [page, history, prefix, error, team]);
  const messages = Array.from(
    new Map(
      [...(history ?? []), ...(page?.messages ?? [])].map((m) => [m.id, m]),
    ).values(),
  ).sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const cursor = olderCursor === undefined ? page?.olderCursor : olderCursor;
  return (
    <section id="conversation" className="portal-card portal-conversation">
      <div className="portal-section-heading">
        <div>
          <p className="portal-kicker">LET’S KEEP TALKING</p>
          <h2>Project conversation</h2>
        </div>
        <button
          className="portal-plain"
          disabled={busy}
          onClick={async () => {
            try {
              receive(await api<Page>(prefix));
            } catch (reason) {
              error(reason);
            }
          }}
        >
          Refresh conversation
        </button>
      </div>
      <p className="portal-muted">
        Discuss the review, scope, and decisions here. Messages stay in this
        project; payment or scope changes still need an approved proposal.
      </p>
      {!page ? (
        <p role="status">Loading conversation…</p>
      ) : (
        <>
          {cursor && (
            <button
              className="portal-plain"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const older = await api<Page>(`${prefix}?before=${cursor}`);
                  setHistory((prev) => [...older.messages, ...prev]);
                  setOlderCursor(older.olderCursor);
                } catch (reason) {
                  error(reason);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load earlier messages
            </button>
          )}
          {messages.length > 0 && (
            <button
              className="portal-plain"
              onClick={() =>
                listRef.current?.lastElementChild?.scrollIntoView({
                  block: "nearest",
                })
              }
            >
              Jump to latest message ↓
            </button>
          )}
          <ol
            ref={listRef}
            className="conversation-messages"
            aria-label="Project messages"
          >
            {messages.length ? (
              messages.map((message) => (
                <li
                  key={message.id}
                  className={`message-${message.authorRole.toLowerCase()}`}
                >
                  <div
                    data-message-id={
                      message.authorRole === (team ? "CUSTOMER" : "TEAM")
                        ? message.id
                        : undefined
                    }
                    data-date={message.createdAt}
                  >
                    <strong>
                      {message.authorRole === "TEAM"
                        ? "m8itwork team"
                        : "Customer"}{" "}
                      <span>@{message.authorName}</span>
                    </strong>
                    <time dateTime={message.createdAt}>
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(message.createdAt))}
                    </time>
                  </div>
                  <p className="portal-preserve">{message.body}</p>
                </li>
              ))
            ) : (
              <li className="portal-empty">
                No messages yet.{" "}
                {team
                  ? readOnly
                    ? "There are no saved messages for this project."
                    : "Introduce yourself and ask about the customer’s next step."
                  : "Ask a question or tell us more about your next step."}
              </li>
            )}
          </ol>
        </>
      )}
      {!readOnly && (
        <form
          ref={formRef}
          onInput={draft.capture}
          onChange={draft.capture}
          className="portal-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const id = form.elements.namedItem("messageId") as HTMLInputElement;
            const lastBody = form.elements.namedItem(
              "lastAttemptBody",
            ) as HTMLInputElement;
            const body = String(new FormData(form).get("body"));
            setBusy(true);
            setNotice(null);
            try {
              let originalSaved = false;
              if (id.value && lastBody.value !== body) {
                const latest = await api<Page>(prefix);
                receive(latest);
                originalSaved = latest.messages.some(
                  (message) => message.id === id.value,
                );
                id.value = crypto.randomUUID();
              }
              id.value ||= crypto.randomUUID();
              lastBody.value = body;
              draft.capture();
              await api(prefix, {
                id: id.value,
                body,
              });
              form.reset();
              draft.clear();
              setNotice(
                originalSaved
                  ? "Your earlier message was already saved. The edited text is saved as a new message."
                  : "Message saved in the project.",
              );
              receive(await api<Page>(prefix));
              requestAnimationFrame(() =>
                listRef.current?.lastElementChild?.scrollIntoView({
                  block: "nearest",
                }),
              );
            } catch (reason) {
              error(reason);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input type="hidden" name="messageId" />
          <input type="hidden" name="lastAttemptBody" />
          <label>
            {team ? "Message to the customer" : "Message to the team"}
            <textarea
              name="body"
              rows={4}
              minLength={1}
              maxLength={5000}
              required
              placeholder="Share a question, update, or decision. Leave out passwords and secrets."
            />
          </label>
          {notice && (
            <p role="status" className="portal-notice">
              {notice}
            </p>
          )}
          <button className="button" disabled={busy}>
            {busy ? "Saving…" : "Send message"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      <p className="portal-muted">
        Checks for new messages every 15 seconds while this page is open. No
        email notifications yet.
      </p>
    </section>
  );
}
