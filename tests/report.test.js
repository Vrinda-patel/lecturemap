// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../static/report.js");

const SRC = (n, extra = {}) => ({ n, youtube_id: "qikxEIxsXco", label: `Ep ${n}`, title: `Episode ${n}`, start: 100 + n, time: `1:4${n}`, ...extra });
const META = { date: "25 Nov 2026, 10:00 am", source: "All episodes · Namaste JavaScript", lang: "Hinglish" };

// --- shared / sanitisation ---------------------------------------------------

test("tsLink builds a YouTube link at the exact second", () => {
  const html = R.tsLink(SRC(2));
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=qikxEIxsXco&amp;t=102s"/);
  assert.match(html, /▶ Ep 2 · 1:42/);
});

test("tsLink rejects unsafe or missing video ids", () => {
  assert.equal(R.tsLink(null), "");
  assert.equal(R.tsLink(SRC(1, { youtube_id: 'x" onmouseover="alert(1)' })), "");
  assert.equal(R.tsLink(SRC(1, { youtube_id: "javascript:alert(1)" })), "");
});

test("user-typed text is escaped, never rendered as HTML", () => {
  const html = R.conversation([{ q: "<img src=x onerror=alert(1)>", answer: "ok", sources: [] }], META);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("AI markdown goes through the injected sanitiser", () => {
  let calls = 0;
  const md = s => { calls++; return `<p>${R.esc(s)}</p>`; };
  const html = R.conversation([{ q: "q", answer: "<script>alert(1)</script>", sources: [] }], META, { md });
  assert.equal(calls, 1);
  assert.ok(!html.includes("<script>"));
});

test("filename is dated and per type", () => {
  const d = new Date(2026, 10, 5);
  assert.equal(R.filename("conversation", d), "LectureMap-Conversation-2026-11-05");
  assert.equal(R.filename("exam", d), "LectureMap-Exam-Revision-2026-11-05");
  assert.equal(R.filename("interview", d), "LectureMap-Interview-Report-2026-11-05");
});

// --- conversation ---------------------------------------------------------------

test("conversation: questions, answers, code and clickable citations", () => {
  const html = R.conversation([{
    q: "Closure kya hota hai?",
    answer: "Closure = function + lexical scope [1].\n\n```js\nfunction x(){ var a = 7; return () => a; }\n```",
    sources: [SRC(1), SRC(2)], source: META.source,
  }], META);
  assert.match(html, /Doubt session: Closure kya hota hai\?/);
  assert.match(html, /25 Nov 2026/);
  assert.match(html, /t=101s/);                 // cited [1] became a link
  assert.ok(!/\[1\]/.test(html));               // marker removed
  assert.match(html, /Also see .*t=102s/s);     // uncited source still listed
  assert.match(html, /function x\(\)/);         // code kept
  assert.match(html, /Lecture moments in this session/);
});

test("conversation: missing data gives a friendly error", () => {
  for (const turns of [[], null, undefined, [{ q: "", answer: "" }]]) {
    assert.throws(() => R.conversation(turns, META), e => e instanceof R.ReportError && /Pehle ek doubt poocho/.test(e.message));
  }
});

test("conversation: long session keeps every turn", () => {
  const long = "x".repeat(4000);
  const turns = Array.from({ length: 300 }, (_, i) => ({ q: `Question number ${i + 1}`, answer: `${long} [1]`, sources: [SRC(1)] }));
  const html = R.conversation(turns, META);
  assert.match(html, /Q300/);
  assert.match(html, /Question number 300/);
  assert.equal((html.match(/class="r-turn"/g) || []).length, 300);
  assert.match(html, /<b>300<\/b><span>questions<\/span>/);
});

// --- exam -------------------------------------------------------------------------

const QUIZ = [
  { q: "Output kya hoga?\n```js\nconsole.log(typeof null)\n```", options: ["null", "object", "undefined", "error"], answer: 1, explain: "Legacy bug.", source: SRC(3) },
  { q: "TDZ kya hai?", options: ["a", "b", "c", "d"], answer: 0, explain: "Before init.", source: SRC(4) },
];

test("exam: notes, options, correct answers, explanations and score", () => {
  const html = R.exam({ topic: "types", notes: [{ point: "typeof null is object", source: SRC(3) }], quiz: QUIZ, picks: [1, 2] }, META);
  assert.match(html, /Exam revision: types/);
  assert.match(html, /typeof null is object/);
  assert.match(html, /<li class="right"><span class="r-letter">B<\/span><span>object<\/span><em>Correct<\/em><em>Your answer<\/em>/);
  assert.match(html, /<li class="wrong"><span class="r-letter">C<\/span>/);
  assert.match(html, /Legacy bug\./);
  assert.match(html, /<b>1\/2<\/b><span>your score<\/span>/);
});

test("exam: unanswered quiz still exports with answer key", () => {
  const html = R.exam({ notes: [], quiz: QUIZ, picks: [null, null] }, META);
  assert.match(html, /Not attempted/);
  assert.match(html, /<em>Correct<\/em>/);
  assert.ok(!/your score/.test(html));
});

test("exam: missing data gives a friendly error", () => {
  for (const d of [null, {}, { quiz: [] }]) {
    assert.throws(() => R.exam(d, META), e => e instanceof R.ReportError && /Exam prep/.test(e.message));
  }
});

// --- interview --------------------------------------------------------------------

const ROUND = (score, extra = {}) => ({
  question: "Explain closures", answer: "A function remembering its scope", score,
  feedback: "Good start.", ideal_answer: "A closure is...", strengths: ["Clear definition"], weaknesses: ["No example"],
  source: SRC(5), ...extra,
});

test("interview: scores, overall average, feedback, strengths/weaknesses, plan", () => {
  const html = R.interview({ topic: "closures", rounds: [ROUND(8), ROUND(4, { question: "What is hoisting?", weaknesses: ["Missed TDZ"] })] }, META);
  assert.match(html, /<b>6\.0\/10<\/b><span>overall score<\/span>/);
  assert.match(html, /8\/10/);
  assert.match(html, /4\/10/);
  assert.match(html, /Clear definition/);
  assert.match(html, /Missed TDZ/);
  assert.match(html, /A closure is\.\.\./);
  assert.match(html, /Revision plan[\s\S]*What is hoisting\?[\s\S]*Focus on: Missed TDZ/);
});

test("interview: skipped answer and old responses without strengths/weaknesses", () => {
  const html = R.interview({ rounds: [ROUND(0, { answer: "", strengths: undefined, weaknesses: undefined })] }, META);
  assert.match(html, /skipped/);
  assert.match(html, /No clear strengths yet/);
});

test("interview: all strong answers → no weak areas", () => {
  const html = R.interview({ rounds: [ROUND(9)] }, META);
  assert.match(html, /Every answer scored 7 or more/);
});

test("interview: missing data gives a friendly error", () => {
  for (const d of [null, { rounds: [] }, { rounds: [{ question: "q" }] }]) {
    assert.throws(() => R.interview(d, META), e => e instanceof R.ReportError && /Mock interview/.test(e.message));
  }
});

test("interview: long session keeps every round", () => {
  const html = R.interview({ rounds: Array.from({ length: 60 }, (_, i) => ROUND(i % 11, { question: `Q-${i + 1} ${"y".repeat(500)}` })) }, META);
  assert.equal((html.match(/class="r-round"/g) || []).length, 60);
  assert.match(html, /<b>60<\/b><span>questions<\/span>/);
});

test("interview: escapes the candidate's answer", () => {
  const html = R.interview({ rounds: [ROUND(5, { answer: "<b onclick=x>hi</b>" })] }, META);
  assert.ok(html.includes("&lt;b onclick=x&gt;hi&lt;/b&gt;"));
});
