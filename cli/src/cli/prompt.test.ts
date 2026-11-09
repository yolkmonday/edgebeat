import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createIo } from "./prompt";

const makeStreams = () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.resume();
  return { stdin, stdout };
};

describe("createIo on a non-TTY stream", () => {
  test("two piped lines feed two prompts", async () => {
    const { stdin, stdout } = makeStreams();
    const io = createIo({ stdin, stdout, env: {} });
    stdin.write("one\ntwo\n");
    expect(await io.prompt("a: ")).toBe("one");
    expect(await io.prompt("b: ", { secret: true })).toBe("two");
    expect(io.isTTY).toBe(false);
  });

  test("ended stream rejects pending and later prompts with a usage error", async () => {
    const { stdin, stdout } = makeStreams();
    const io = createIo({ stdin, stdout, env: {} });
    const pending = io.prompt("a: ");
    stdin.end();
    const err = await pending.catch((e) => e);
    expect(err.message).toContain("No input");
    expect(err.usage).toBe(true);
    expect(await io.prompt("b: ").catch((e) => e.usage)).toBe(true);
  });

  test("lines buffered before EOF are still served", async () => {
    const { stdin, stdout } = makeStreams();
    const io = createIo({ stdin, stdout, env: {} });
    stdin.end("only\n");
    expect(await io.prompt("a: ")).toBe("only");
    expect(await io.prompt("b: ").catch((e) => e.usage)).toBe(true);
  });
});
