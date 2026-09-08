import assert from "node:assert/strict";
import test from "node:test";
import { BACKEND, ROOT, databaseUrlFor, discoverServices } from "./rumahl-dev.mjs";

test("discovers the monorepo frontend and nested Rust services", () => {
  const services = discoverServices();
  const frontend = services.find(service => service.id === "frontend");
  const home = services.find(service => service.id === "rumahl-home");
  const devVm = services.find(service => service.id === "rumahl-dev-vm");

  assert.ok(services.length > 20);
  assert.equal(frontend?.cwd, `${ROOT}/frontend`);
  assert.equal(home?.cwd, BACKEND);
  assert.equal(home?.port, 3001);
  assert.equal(home?.autostart, true);
  assert.equal(devVm?.autostart, false);
  assert.equal(devVm?.type, "dev-vm");
});

test("does not autostart development-image applications with system services", () => {
  const services = discoverServices();
  assert.equal(services.find(service => service.id === "rumahl-developer-app")?.autostart, false);
  assert.equal(services.find(service => service.id === "rumahl-dev-bridge")?.autostart, false);
});

test("uses initialized dedicated databases and the shared development database", () => {
  const env = { POSTGRES_USER: "rumahl", POSTGRES_PASSWORD: "secret", POSTGRES_PORT: "5544" };
  assert.equal(databaseUrlFor("rumahl-core", env), "postgres://rumahl:secret@127.0.0.1:5544/rumahl_core");
  assert.equal(databaseUrlFor("rumahl-backup", env), "postgres://rumahl:secret@127.0.0.1:5544/rumahl_home");
  assert.equal(databaseUrlFor("rumahl-home", { ...env, rumahl_HOME_DB_URL: "postgres://custom/home" }), "postgres://custom/home");
});
