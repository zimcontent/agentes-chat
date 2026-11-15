import { expect, test } from "bun:test";
import { pastedOAuthReturn } from "../src/lib/oauth-paste";

test("the address a sign-in ended on, pasted whole, as its query alone, or with spaces around it", () => {
  const url = "http://127.0.0.1:33418/dougbot/connectors/oauth?code=c0de&state=st4te";
  expect(pastedOAuthReturn(url)).toEqual({ state: "st4te", code: "c0de" });
  expect(pastedOAuthReturn(`  ${url}\n`)).toEqual({ state: "st4te", code: "c0de" });
  expect(pastedOAuthReturn("?code=c0de&state=st4te")).toEqual({ state: "st4te", code: "c0de" });
  expect(pastedOAuthReturn("code=c0de&state=st4te")).toEqual({ state: "st4te", code: "c0de" });
});

test("a refusal says so; anything without both the code and the state is nothing", () => {
  expect(pastedOAuthReturn("http://127.0.0.1:33418/x?error=access_denied&state=s")).toEqual({
    error: "access_denied",
  });
  expect(pastedOAuthReturn("http://127.0.0.1:33418/x?code=c0de")).toBeNull();
  expect(pastedOAuthReturn("https://next.frame.io/projects")).toBeNull();
  expect(pastedOAuthReturn("")).toBeNull();
  expect(pastedOAuthReturn("not an address")).toBeNull();
});
