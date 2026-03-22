export type ParsedSseEvent = {
  data: string;
  event: string;
};

const FRAME_DELIMITER = "\n\n";

export function encodeSseEvent(event: string, data: unknown) {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data, null, 0);
  const lines = payload.split("\n").map((line) => `data: ${line}`);

  return [`event: ${event}`, ...lines, "", ""].join("\n");
}

export function parseSseFrames(buffer: string): {
  events: ParsedSseEvent[];
  remainder: string;
} {
  const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
  const frames = normalizedBuffer.split(FRAME_DELIMITER);

  if (frames.length === 1) {
    return {
      events: [],
      remainder: normalizedBuffer,
    };
  }

  const remainder = frames.pop() ?? "";
  const events = frames
    .map((frame) => parseSseFrame(frame))
    .filter((event): event is ParsedSseEvent => event !== null);

  return { events, remainder };
}

function parseSseFrame(frame: string): ParsedSseEvent | null {
  const lines = frame.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    data: dataLines.join("\n"),
    event,
  };
}
