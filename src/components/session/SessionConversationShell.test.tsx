import { fireEvent, render, screen } from "@testing-library/react";
import { SessionConversationShell } from "./SessionConversationShell";
import type { SessionThreadItem } from "../../lib/session-thread";

function createItems(
  overrides: Partial<SessionThreadItem>[] = [],
): SessionThreadItem[] {
  const base: SessionThreadItem[] = [
    {
      content: "What are you stuck on?",
      id: "prompt:opening",
      kind: "prompt",
      prompt: "opening",
      role: "assistant",
      synthetic: true,
    },
    {
      content: "Ship the first build",
      id: "message-1",
      kind: "message",
      persisted: true,
      role: "user",
    },
  ];

  return overrides.length === 0
    ? base
    : base.concat(overrides as SessionThreadItem[]);
}

function createMediaQueryList(matches: boolean): MediaQueryList {
  return {
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  };
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  },
) {
  let scrollTop = metrics.scrollTop;

  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

describe("SessionConversationShell", () => {
  const matchMediaMock = vi.fn<(query: string) => MediaQueryList>();
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMediaMock,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });

    matchMediaMock.mockImplementation(() => createMediaQueryList(false));
  });

  afterEach(() => {
    scrollIntoViewMock.mockReset();
    matchMediaMock.mockReset();
  });

  it("auto-scrolls when new thread content appears and the user is near the bottom", () => {
    const { rerender } = render(<SessionConversationShell items={createItems()} />);
    const conversationLog = screen.getByRole("log", {
      name: "Conversation",
    });

    setScrollMetrics(conversationLog, {
      clientHeight: 240,
      scrollHeight: 480,
      scrollTop: 240,
    });
    fireEvent.scroll(conversationLog);
    scrollIntoViewMock.mockClear();

    rerender(
      <SessionConversationShell
        items={createItems([
          {
            content: "Here are the next steps.",
            id: "message-2",
            kind: "message",
            persisted: true,
            role: "assistant",
          },
        ])}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  });

  it("does not auto-scroll when the user has moved away from the bottom", () => {
    const { rerender } = render(<SessionConversationShell items={createItems()} />);
    const conversationLog = screen.getByRole("log", {
      name: "Conversation",
    });

    setScrollMetrics(conversationLog, {
      clientHeight: 240,
      scrollHeight: 480,
      scrollTop: 0,
    });
    fireEvent.scroll(conversationLog);
    scrollIntoViewMock.mockClear();

    rerender(
      <SessionConversationShell
        items={createItems([
          {
            content: "Still thinking...",
            id: "message:streaming",
            kind: "message",
            persisted: false,
            role: "assistant",
            status: "streaming",
          },
        ])}
      />,
    );

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("uses instant scrolling behavior while the latest message is streaming", () => {
    const { rerender } = render(<SessionConversationShell items={createItems()} />);
    const conversationLog = screen.getByRole("log", {
      name: "Conversation",
    });

    setScrollMetrics(conversationLog, {
      clientHeight: 240,
      scrollHeight: 480,
      scrollTop: 240,
    });
    fireEvent.scroll(conversationLog);
    scrollIntoViewMock.mockClear();

    rerender(
      <SessionConversationShell
        items={createItems([
          {
            content: "Still thinking...",
            id: "message:streaming",
            kind: "message",
            persisted: false,
            role: "assistant",
            status: "streaming",
          },
        ])}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "auto",
      block: "end",
      inline: "nearest",
    });
  });

  it("uses instant scrolling behavior when reduced motion is preferred", () => {
    matchMediaMock.mockImplementation(() => createMediaQueryList(true));

    const { rerender } = render(<SessionConversationShell items={createItems()} />);
    const conversationLog = screen.getByRole("log", {
      name: "Conversation",
    });

    setScrollMetrics(conversationLog, {
      clientHeight: 240,
      scrollHeight: 480,
      scrollTop: 240,
    });
    fireEvent.scroll(conversationLog);
    scrollIntoViewMock.mockClear();

    rerender(
      <SessionConversationShell
        items={createItems([
          {
            content: "Ready when you are.",
            id: "message-2",
            kind: "message",
            persisted: true,
            role: "assistant",
          },
        ])}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "auto",
      block: "end",
      inline: "nearest",
    });
  });
});
