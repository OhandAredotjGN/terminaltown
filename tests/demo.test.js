const test = require("node:test"),
  assert = require("node:assert/strict");
const demo = require("../src/demo");
test("simulated prompts and sessions update only demo state", async () => {
  const b = { boardId: "test" };
  await demo.createAiSession({
    session: "unit-demo",
    title: "Test",
    placement: 0,
    board: b,
  });
  await demo.sendPrompt("unit-demo", "hello");
  const state = await demo.collect(b);
  assert.match(state.sessions[0].output, /hello/);
  assert.match(state.warning, /DEMO/);
  await demo.byeSession("unit-demo");
  assert.equal((await demo.collect(b)).sessions[0].name, "");
});
test("invalid grid sizes and slots are rejected", async () => {
  await assert.rejects(demo.setGridShape(99, 99, {}));
  await assert.rejects(demo.assignSlot(-1, "", {}));
});
