import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Io } from "./run";

// Real terminal Io. Secret answers are read through a muted output so nothing is echoed.
export const createIo = (): Io => {
  const { stdin, stdout } = process;

  const prompt: Io["prompt"] = async (q, opts) => {
    if (opts?.secret && stdin.isTTY) {
      stdout.write(q);
      const muted = new Writable({ write: (_chunk, _enc, done) => done() });
      const rl = createInterface({ input: stdin, output: muted, terminal: true });
      try {
        return (await rl.question("")).trim();
      } finally {
        rl.close();
        stdout.write("\n");
      }
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return (await rl.question(q)).trim();
    } finally {
      rl.close();
    }
  };

  return {
    prompt,
    print: (line) => console.log(line),
    isTTY: Boolean(stdout.isTTY),
    env: process.env,
  };
};
