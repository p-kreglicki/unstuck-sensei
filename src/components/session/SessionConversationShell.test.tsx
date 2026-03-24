import { fireEvent, render, screen } from "@testing-library/react";
import { SessionConversationShell } from "./SessionConversationShell";
import type { SessionThreadItem } from "../../lib/session-thread";

function createItems(
  overrides: SessionThreadItem[] = [],
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

  return overrides.length === 0 ? base : base.concat(overrides);
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
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );

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

    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
      return;
    }

    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("auto-scrolls when new thread content appears and the user is near the bottom", () => {
    const { rerender } = render(
      <SessionConversationShell activeStage="compose" items={createItems()} />,
    );
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
        activeStage="steps"
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
    const { rerender } = render(
      <SessionConversationShell activeStage="compose" items={createItems()} />,
    );
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
        activeStage="energy"
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
    const { rerender } = render(
      <SessionConversationShell activeStage="compose" items={createItems()} />,
    );
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
        activeStage="energy"
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

    const { rerender } = render(
      <SessionConversationShell activeStage="compose" items={createItems()} />,
    );
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
        activeStage="steps"
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

  it("renders assistant messages with a sensei avatar beside the bubble", () => {
    render(
      <SessionConversationShell activeStage="compose" items={createItems()} />,
    );

    expect(screen.getByTestId("sensei-avatar")).toBeInTheDocument();
    expect(screen.getByText("What are you stuck on?")).toBeInTheDocument();
  });

  it("focuses the composer on text stages and moves focus to inline controls on stage changes", () => {
    const { rerender } = render(
      <SessionConversationShell
        activeStage="compose"
        composer={<textarea aria-label="Session reply" />}
        items={createItems()}
      />,
    );

    const composer = screen.getByLabelText("Session reply");
    expect(composer).toHaveFocus();

    rerender(
      <SessionConversationShell
        activeStage="energy"
        items={[
          ...createItems(),
          {
            control: "energy",
            id: "control:energy",
            kind: "control",
          },
        ]}
        renderControl={() => (
          <div>
            <button type="button">Low</button>
            <button type="button">Medium</button>
          </div>
        )}
      />,
    );

    expect(screen.getByRole("button", { name: "Low" })).toHaveFocus();

    rerender(
      <SessionConversationShell
        activeStage="clarifying"
        composer={<textarea aria-label="Clarifying reply" />}
        items={createItems()}
      />,
    );

    expect(screen.getByLabelText("Clarifying reply")).toHaveFocus();
  });

  it("does not steal focus when streaming output updates inside the current control stage", () => {
    const { rerender } = render(
      <SessionConversationShell
        activeStage="energy"
        items={[
          ...createItems(),
          {
            control: "energy",
            id: "control:energy",
            kind: "control",
          },
        ]}
        renderControl={() => (
          <div>
            <button type="button">Low</button>
            <button type="button">Medium</button>
          </div>
        )}
      />,
    );

    const mediumButton = screen.getByRole("button", { name: "Medium" });
    mediumButton.focus();
    expect(mediumButton).toHaveFocus();

    rerender(
      <SessionConversationShell
        activeStage="energy"
        items={[
          ...createItems([
            {
              content: "Still thinking...",
              id: "message:streaming",
              kind: "message",
              persisted: false,
              role: "assistant",
              status: "streaming",
            },
          ]),
          {
            control: "energy",
            id: "control:energy",
            kind: "control",
          },
        ]}
        renderControl={() => (
          <div>
            <button type="button">Low</button>
            <button type="button">Medium</button>
          </div>
        )}
      />,
    );

    expect(screen.getByRole("button", { name: "Medium" })).toHaveFocus();
  });

  it("keeps the control ref pointed at the active stage when multiple controls render", () => {
    const { rerender } = render(
      <SessionConversationShell
        activeStage="compose"
        composer={<textarea aria-label="Session reply" />}
        items={createItems()}
      />,
    );

    rerender(
      <SessionConversationShell
        activeStage="energy"
        items={[
          ...createItems(),
          {
            control: "energy",
            id: "control:energy",
            kind: "control",
          },
          {
            control: "steps",
            id: "control:steps",
            kind: "control",
          },
        ]}
        renderControl={(control) => (
          <div>
            <button type="button">
              {control === "energy" ? "Energy control" : "Steps control"}
            </button>
          </div>
        )}
      />,
    );

    expect(screen.getByRole("button", { name: "Energy control" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Steps control" })).not.toHaveFocus();
  });

  it("does not steal focus on initial mount when no composer is present", () => {
    const existingFocus = document.createElement("button");
    existingFocus.type = "button";
    existingFocus.textContent = "Existing focus";
    document.body.appendChild(existingFocus);
    existingFocus.focus();

    try {
      render(
        <SessionConversationShell
          activeStage="energy"
          items={[
            ...createItems(),
            {
              control: "energy",
              id: "control:energy",
              kind: "control",
            },
          ]}
          renderControl={() => (
            <div>
              <button type="button">Energy control</button>
            </div>
          )}
        />,
      );

      expect(existingFocus).toHaveFocus();
      expect(screen.getByRole("button", { name: "Energy control" })).not.toHaveFocus();
    } finally {
      existingFocus.remove();
    }
  });
});
