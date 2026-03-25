import { useLayoutEffect, useRef, type ReactNode } from "react";
import type {
  SessionStage,
  SessionThreadControlItem,
  SessionThreadItem,
} from "../../lib/session-thread";
import senseiDefaultAvatar from "../../assets/sensei-default-avatar.png";

type SessionConversationShellProps = {
  activeStage: SessionStage;
  composer?: ReactNode;
  items: SessionThreadItem[];
  renderControl?(control: SessionThreadControlItem["control"]): ReactNode | null;
};

const STICKY_SCROLL_THRESHOLD_PX = 96;
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function isNearBottom(element: HTMLDivElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    STICKY_SCROLL_THRESHOLD_PX
  );
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function shouldUseInstantScroll(item: SessionThreadItem | undefined) {
  if (prefersReducedMotion()) {
    return true;
  }

  return item?.kind === "message" && item.status === "streaming";
}

function focusFirstElement(container: HTMLDivElement | null) {
  const target = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);

  if (target && document.activeElement !== target) {
    target.focus();
  }
}

function threadItemSpacingClass(
  item: SessionThreadItem,
  previousItem: SessionThreadItem | undefined,
) {
  if (!previousItem) {
    return "";
  }

  if (item.kind === "control" || previousItem.kind === "control") {
    return "mt-3";
  }

  return "mt-2";
}

function SenseiAvatar() {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="h-8 w-8 shrink-0 rounded-full object-cover shadow-[0_4px_12px_rgba(2,6,23,0.18)]"
      data-testid="sensei-avatar"
      src={senseiDefaultAvatar}
    />
  );
}

export function SessionConversationShell({
  activeStage,
  composer,
  items,
  renderControl,
}: SessionConversationShellProps) {
  const composerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const previousStageRef = useRef<SessionStage | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const hasComposer = composer !== undefined && composer !== null;

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }

    const lastItem = items[items.length - 1];

    bottomRef.current?.scrollIntoView?.({
      behavior: shouldUseInstantScroll(lastItem) ? "auto" : "smooth",
      block: "end",
      inline: "nearest",
    });
  }, [items]);

  useLayoutEffect(() => {
    const previousStage = previousStageRef.current;

    if (previousStage === activeStage) {
      return;
    }

    // On initial mount, only text-entry stages take focus immediately.
    // Control-only mounts preserve the page's existing focus until a stage transition.
    if (previousStage !== null || hasComposer) {
      focusFirstElement(hasComposer ? composerRef.current : controlRef.current);
    }

    previousStageRef.current = activeStage;
  }, [activeStage, hasComposer]);

  return (
    <section
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-white/10 bg-white/[0.04] backdrop-blur"
    >
      <h2 id="conversation-heading" className="sr-only">
        Conversation
      </h2>

      <div
        aria-labelledby="conversation-heading"
        aria-relevant="additions text"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
        onScroll={(event) => {
          shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
        }}
        role="log"
      >
        <div>
          {items.map((item, index) => {
            const spacingClass = threadItemSpacingClass(item, items[index - 1]);

            if (item.kind === "control") {
              const renderedControl = renderControl?.(item.control) ?? null;

              return renderedControl ? (
                <article
                  key={item.id}
                  className={["flex justify-start", spacingClass].join(" ").trim()}
                >
                  <div
                    ref={item.control === activeStage ? controlRef : undefined}
                    className="w-full max-w-[86%]"
                  >
                    {renderedControl}
                  </div>
                </article>
              ) : null;
            }

            const isUser = item.role === "user";
            const isStreaming = item.kind === "message" && item.status === "streaming";

            return (
              <article
                key={item.id}
                className={[
                  isUser ? "flex justify-end" : "flex justify-start",
                  spacingClass,
                ].join(" ").trim()}
              >
                {isUser ? (
                  <div
                    className={[
                      "max-w-[86%] rounded-2xl rounded-br-none border px-3 py-3 shadow-sm",
                      "border-white/10 bg-slate-950/80 text-slate-100",
                    ].join(" ")}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                  </div>
                ) : (
                  <div className="flex max-w-[92%] items-end gap-2">
                    <SenseiAvatar />
                    <div
                      className={[
                        "min-w-0 flex-1 rounded-2xl rounded-bl-none border px-3 py-3 shadow-sm",
                        "border-white/10 bg-white/[0.05] text-slate-100",
                      ].join(" ")}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                      {isStreaming ? (
                        <div className="mt-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-teal-100/70">
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-200/80" />
                          <span>Streaming</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {composer ? (
        <div
          ref={composerRef}
          className="border-t border-white/10 bg-slate-950/80 px-4 py-4 backdrop-blur"
        >
          {composer}
        </div>
      ) : null}
    </section>
  );
}
