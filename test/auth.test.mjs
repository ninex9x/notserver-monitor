import test from "node:test";
import assert from "node:assert/strict";
import { ACCESS_COOKIE, accessCookie, requestToken, tokenMatches } from "../src/auth.mjs";

test("compara tokens sem aceitar valores vazios ou parciais", () => {
  assert.equal(tokenMatches("segredo-forte", "segredo-forte"), true);
  assert.equal(tokenMatches("segredo", "segredo-forte"), false);
  assert.equal(tokenMatches("", "segredo-forte"), false);
});

test("prioriza Bearer e aceita o cookie seguro", () => {
  assert.equal(requestToken({ headers: { authorization: "Bearer token-api" } }), "token-api");
  assert.equal(requestToken({ headers: { cookie: `tema=dark; ${ACCESS_COOKIE}=token%20web` } }), "token web");
});

test("cookie de sessão é restrito ao host, seguro e inacessível ao JavaScript", () => {
  const cookie = accessCookie("abc123");
  assert.match(cookie, /^__Host-notserver_access=abc123;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});
