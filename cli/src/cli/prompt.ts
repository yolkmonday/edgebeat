import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { Io } from "./run";

type CreateIoOptions = {
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
};

const NO_INPUT = "No input: pass --yes with flags or run in a terminal";

// Marked so run() maps it to exit code 2.
const noInputError = (): Error & { usage: true } => Object.assign(new Error(NO_INPUT), { usage: true as const });

type Waiter = { resolve: (line: string) => void; reject: (e: Error) => void };

// Real terminal Io. One readline interface lives for the whole process so piped
// stdin is never lost between prompts; secret answers are not echoed.
export const createIo = (opts: CreateIoOptions = {}): Io => {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const interactive = Boolean(stdin.isTTY && stdout.isTTY);

  const state = { muted: false, closed: false };
  const lines: string[] = [];
  const waiters: Waiter[] = [];

  const output = new Writable({
    write: (chunk, encoding, done) => {
      if (!state.muted) stdout.write(chunk, encoding as BufferEncoding);
      done();
    },
  });
  const rl = createInterface({ input: stdin, output, terminal: interactive });

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(line);
    else lines.push(line);
  });
  rl.on("close", () => {
    state.closed = true;
    waiters.splice(0).forEach((w) => w.reject(noInputError()));
  });
  rl.on("SIGINT", () => {
    state.muted = false;
    stdout.write("\n");
    rl.close();
    exit(130);
  });

  const nextLine = (): Promise<string> => {
    const queued = lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (state.closed) return Promise.reject(noInputError());
    return new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
  };

  const prompt: Io["prompt"] = async (q, options) => {
    stdout.write(q);
    const hide = Boolean(options?.secret && interactive);
    state.muted = hide;
    try {
      return (await nextLine()).trim();
    } finally {
      state.muted = false;
      if (hide) stdout.write("\n");
    }
  };

  return {
    prompt,
    print: (line) => {
      stdout.write(`${line}\n`);
    },
    isTTY: interactive,
    env: opts.env ?? process.env,
  };
};
