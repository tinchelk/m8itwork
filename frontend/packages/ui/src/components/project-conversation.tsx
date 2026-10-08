"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, WorkspaceError, type Message } from "./workspace-types";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const reading = useRef<string | null>(null);
  const receivedIds = useRef<Set<string> | null>(null);
  const [incomingCount, setIncomingCount] = useState(0);
  const draft = useFormDraft(formRef, accountId, `conversation:${projectId}`);
  const prefix = `${team ? "/v1/operator/projects" : "/v1/projects"}/${projectId}/messages`;
  const error = useCallback((reason: unknown) => {
    setLoadError(reason instanceof Error ? reason.message : "The conversation could not be loaded. Try Refresh conversation.");
    if (reason instanceof WorkspaceError && [401, 403].includes(reason.status)) onError(reason);
  }, [onError]);
  const receive = useCallback((result: Page) => {
    if (receivedIds.current) {
      const added = result.messages.filter((message) => !receivedIds.current!.has(message.id) && message.authorRole === (team ? "CUSTOMER" : "TEAM"));
      if (added.length) setIncomingCount((count) => count + added.length);
    }
    receivedIds.current = new Set([...(receivedIds.current ?? []), ...result.messages.map((message) => message.id)]);
    setHistory((previous) => [
      ...new Map(
        [...previous, ...result.messages].map((message) => [
          message.id,
          message,
        ]),
      ).values(),
    ]);
    setPage(result);
    setLoadError(null);
  }, [team]);
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
          disabled={busy || refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              receive(await api<Page>(prefix));
              setNotice("Conversation refreshed.");
            } catch (reason) {
              error(reason);
            } finally { setRefreshing(false); }
          }}
        >
          {refreshing ? "Refreshing conversation…" : "Refresh conversation"}
        </button>
      </div>
      <p className="portal-muted">
        Discuss the review, scope, and decisions here. Messages stay in this
        project; payment or scope changes still need an approved proposal.
      </p>
      {loadError && <p role="alert" className="portal-error">{loadError} Use Refresh conversation to retry.</p>}
      {!page ? loadError ? <p>The conversation is currently unavailable. Your saved messages and draft are retained.</p> : (
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
              onClick={() => {
                setIncomingCount(0);
                listRef.current?.lastElementChild?.scrollIntoView({
                  block: "nearest",
                });
              }}
            >
              Jump to latest message ↓
            </button>
          )}
          <p className="conversation-announcement" aria-live="polite" aria-atomic="true">
            {incomingCount > 0 ? `${incomingCount} new ${team ? "customer" : "team"} ${incomingCount === 1 ? "message" : "messages"} received. Jump to latest to read.` : ""}
          </p>
          <div className="conversation-history" role="region" aria-label="Project message history" tabIndex={0}>
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
          </div>
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
              disabled={busy}
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
        Checks for new messages every 15 seconds while this page is open.
        {team ? "Team emails can be managed under Team email notifications in the backoffice." : "Project emails can be managed in Account settings."}
      </p>
    </section>
  );
}
