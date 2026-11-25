// LectureMap – PDF report builders.
// Pure functions: session data (already in the browser) → printable HTML. No network, no AI calls.
// Loaded by index.html as window.LMReport, and by tests/report.test.js in Node.
(function (root) {
  "use strict";

  const YT_ID = /^[\w-]{11}$/;
  // [2] / 【2】 / [1, 3] citations written by the model
  const CITE = /(?:\[|【)\s*(\d+(?:\s*[,，]\s*\d+)*)\s*(?:\]|】)/g;
  const LOGO = `<svg class="r-logo" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="24" fill="#f7df1e"/><path d="M38 28v44l36-22z" fill="#14140f"/></svg>`;

  /** Error whose message is safe and meant to be shown to the user. */
  class ReportError extends Error {}

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // Fallback renderer for AI text when no sanitising markdown renderer is passed in.
  const plain = s => `<p>${esc(s).replace(/\n/g, "<br>")}</p>`;

  /** Replace citation markers in rendered answer HTML using `render(source)`. Shared with the on-screen chat. */
  function linkCitations(html, sources, render) {
    const byN = Object.fromEntries((sources || []).map(s => [String(s.n), s]));
    const cited = new Set();
    const out = String(html).replace(CITE, (m, nums) =>
      nums.split(/[,，]/).map(n => { const s = byN[n.trim()]; if (!s) return ""; cited.add(s.n); return render(s); }).join(" "));
    return { html: out, cited };
  }

  /** Clickable "▶ Ep 10 · 12:44" link that opens YouTube at that second ("" if the source is unusable). */
  function tsLink(s) {
    if (!s || !YT_ID.test(String(s.youtube_id))) return "";
    const t = Math.max(0, Math.floor(Number(s.start) || 0));
    return `<a class="r-ts" href="https://www.youtube.com/watch?v=${s.youtube_id}&amp;t=${t}s" title="${esc(s.title)}">` +
      `▶ ${esc(s.label)} · ${esc(s.time)}</a>`;
  }

  function fileDate(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function filename(kind, date = new Date()) {
    return `LectureMap-${{ conversation: "Conversation", exam: "Exam-Revision", interview: "Interview-Report" }[kind]}-${fileDate(date)}`;
  }

  function shorten(s, n) { s = String(s ?? "").trim().replace(/\s+/g, " "); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function shell(kind, title, meta, stats, body) {
    const rows = [["Date", meta.date], ["Source", meta.source], ["Language", meta.lang], ...(meta.extra || [])]
      .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
    const statHtml = stats.map(([v, k]) => `<div class="r-stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
    return `<article class="report">
<header class="r-head">
  <div class="r-brand">${LOGO}<div><b>LectureMap</b><small>Every doubt, to the exact second</small></div></div>
  <span class="r-kind">${esc(kind)}</span>
</header>
<h1 class="r-title">${esc(title)}</h1>
<dl class="r-meta">${rows}</dl>
${statHtml ? `<div class="r-stats">${statHtml}</div>` : ""}
${body}
<footer class="r-end">Made with LectureMap · lecturemap.embarko.app<br>Timestamp links open the lecture at the exact second. Lecture content belongs to its creators (Namaste JavaScript by Akshay Saini for the built-in course).</footer>
</article>`;
  }

  function list(items, cls) {
    return items.length ? `<ul class="${cls}">${items.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : "";
  }

  // per-answer strengths / weaknesses side by side; a single list takes the full width
  function points(r) {
    const cols = [list(r.strengths || [], "r-good"), list(r.weaknesses || [], "r-bad")].filter(Boolean);
    return cols.length ? `<div class="r-cols">${cols.map(c => `<div>${c}</div>`).join("")}</div>` : "";
  }

  function uniq(arr, key) {
    const seen = new Set();
    return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- Ask → Conversation PDF ----------
  function conversation(turns, meta = {}, opts = {}) {
    const md = opts.md || plain;
    turns = (turns || []).filter(t => t && t.q && typeof t.answer === "string");
    if (!turns.length) throw new ReportError("Abhi tak koi sawaal nahi poocha. Pehle ek doubt poocho, phir Conversation PDF download karo.");

    const moments = [];
    const body = turns.map((t, i) => {
      const { html, cited } = linkCitations(md(t.answer), t.sources, tsLink);
      const used = (t.sources || []).filter(s => cited.has(s.n));
      const rest = (t.sources || []).filter(s => !cited.has(s.n)).slice(0, cited.size ? 2 : 3);
      moments.push(...used, ...rest);
      const also = rest.map(tsLink).filter(Boolean).join(" ");
      return `<section class="r-turn">
  <div class="r-q"><span class="r-n">Q${i + 1}</span><div>${esc(t.q)}${t.source && t.source !== meta.source ? `<small>${esc(t.source)}</small>` : ""}</div></div>
  <div class="r-a">${html}${also ? `<p class="r-also">Also see ${also}</p>` : ""}</div>
</section>`;
    }).join("\n");

    const index = uniq(moments.filter(s => s && YT_ID.test(String(s.youtube_id))), s => `${s.youtube_id}:${s.start}`)
      .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }) || a.start - b.start);
    const indexHtml = index.length ? `<section class="r-section r-keep"><h2>Lecture moments in this session</h2>
<ul class="r-moments">${index.map(s => `<li>${tsLink(s)} <span>${esc(s.title)}</span></li>`).join("")}</ul></section>` : "";

    return shell("Conversation", `Doubt session: ${shorten(turns[0].q, 70)}`, meta,
      [[turns.length, turns.length === 1 ? "question" : "questions"], [index.length, "lecture moments"]],
      `<section class="r-section"><h2>Questions &amp; answers</h2>${body}</section>${indexHtml}`);
  }

  // ---------- Exam → Revision PDF ----------
  function exam(data, meta = {}, opts = {}) {
    const md = opts.md || plain;
    const quiz = (data && data.quiz || []).filter(q => q && Array.isArray(q.options));
    if (!quiz.length) throw new ReportError("Pehle Exam prep mein notes aur quiz generate karo, phir Revision PDF download karo.");
    const notes = (data.notes || []).filter(n => n && n.point);
    const picks = data.picks || [];
    const answered = quiz.filter((q, i) => Number.isInteger(picks[i])).length;
    const score = quiz.filter((q, i) => picks[i] === q.answer).length;
    const L = "ABCD";

    const notesHtml = notes.length ? `<section class="r-section"><h2>Revision notes</h2><ol class="r-notes">${
      notes.map(n => `<li>${esc(n.point)} ${tsLink(n.source)}</li>`).join("")}</ol></section>` : "";

    const quizHtml = quiz.map((q, qi) => {
      const pick = picks[qi];
      const opts = q.options.map((o, oi) => {
        const cls = oi === q.answer ? "right" : oi === pick ? "wrong" : "";
        const tag = oi === q.answer ? `<em>Correct</em>` : oi === pick ? `<em>Your answer</em>` : "";
        const mine = oi === pick && oi === q.answer ? `<em>Your answer</em>` : "";
        return `<li class="${cls}"><span class="r-letter">${L[oi] || oi + 1}</span><span>${esc(o)}</span>${tag}${mine}</li>`;
      }).join("");
      const verdict = !Number.isInteger(pick) ? `<span class="r-pill">Not attempted</span>`
        : pick === q.answer ? `<span class="r-pill good">Correct</span>` : `<span class="r-pill bad">Incorrect</span>`;
      return `<section class="r-qz">
  <div class="r-qhead"><span class="r-n">${qi + 1}</span><div class="r-qtext">${md(q.q)}</div>${verdict}</div>
  <ol class="r-opts">${opts}</ol>
  ${q.explain || q.source ? `<p class="r-explain"><b>Why:</b> ${esc(q.explain)} ${tsLink(q.source)}</p>` : ""}
</section>`;
    }).join("\n");

    const stats = [[notes.length, "revision notes"], [quiz.length, "quiz questions"]];
    if (answered) stats.push([`${score}/${quiz.length}`, answered === quiz.length ? "your score" : `score (${answered} attempted)`]);
    const topic = data.topic ? `Exam revision: ${shorten(data.topic, 60)}` : "Exam revision";
    return shell("Exam revision", topic, { ...meta, extra: data.topic ? [["Focus topic", data.topic]] : [] }, stats,
      `${notesHtml}<section class="r-section"><h2>Quiz with answers</h2>${quizHtml}</section>`);
  }

  // ---------- Interview → Interview report ----------
  function interview(data, meta = {}, opts = {}) {
    const md = opts.md || plain;
    const rounds = (data && data.rounds || []).filter(r => r && r.question && Number.isFinite(Number(r.score)));
    if (!rounds.length) throw new ReportError("Pehle Mock interview mein kam se kam ek answer submit karo, phir Interview Report download karo.");

    const avg = rounds.reduce((s, r) => s + Number(r.score), 0) / rounds.length;
    const verdict = avg >= 8 ? "Interview ready" : avg >= 5 ? "Getting there" : "Needs revision";
    const strengths = uniq(rounds.flatMap(r => r.strengths || []), s => s.toLowerCase()).slice(0, 6);
    const weaknesses = uniq(rounds.flatMap(r => r.weaknesses || []), s => s.toLowerCase()).slice(0, 6);
    const tone = s => s >= 7 ? "good" : s >= 4 ? "mid" : "bad";

    const table = `<table class="r-table"><thead><tr><th>#</th><th>Question</th><th>Score</th></tr></thead><tbody>${
      rounds.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(shorten(r.question, 110))}</td><td><span class="r-pill ${tone(r.score)}">${Number(r.score)}/10</span></td></tr>`).join("")
    }</tbody></table>`;

    const overview = `<section class="r-section r-keep"><h2>Overview</h2>${table}
<div class="r-cols">
  <div><h3>Strengths</h3>${list(strengths, "r-good") || `<p class="r-muted">No clear strengths yet. Keep practising.</p>`}</div>
  <div><h3>Areas to improve</h3>${list(weaknesses, "r-bad") || `<p class="r-muted">No major gaps found.</p>`}</div>
</div></section>`;

    const detail = rounds.map((r, i) => `<section class="r-round">
  <div class="r-qhead"><span class="r-n">${i + 1}</span><div class="r-qtext"><p>${esc(r.question)}</p></div><span class="r-score ${tone(r.score)}">${Number(r.score)}<small>/10</small></span></div>
  <h4>Your answer</h4>
  <div class="r-answer">${r.answer ? esc(r.answer) : `<span class="r-muted">(skipped: "I don't know")</span>`}</div>
  <h4>Feedback</h4>${md(r.feedback || "")}
  ${points(r)}
  <h4>Improved answer</h4><div class="r-ideal">${md(r.ideal_answer || "")}</div>
  ${tsLink(r.source) ? `<p class="r-also">Revise at ${tsLink(r.source)}</p>` : ""}
</section>`).join("\n");

    const weak = rounds.filter(r => Number(r.score) < 7).sort((a, b) => a.score - b.score);
    const plan = weak.length
      ? `<ol class="r-plan">${weak.map(r => `<li><b>${esc(shorten(r.question, 120))}</b> <span class="r-muted">(${Number(r.score)}/10)</span>${
          (r.weaknesses || []).length ? `<br><span class="r-muted">Focus on: ${esc(r.weaknesses.join("; "))}</span>` : ""} ${tsLink(r.source)}</li>`).join("")}</ol>`
      : `<p>Every answer scored 7 or more. Try a harder focus topic next.</p>`;

    return shell("Interview report", data.topic ? `Mock interview: ${shorten(data.topic, 60)}` : "Mock interview report",
      { ...meta, extra: data.topic ? [["Focus topic", data.topic]] : [] },
      [[`${avg.toFixed(1)}/10`, "overall score"], [rounds.length, rounds.length === 1 ? "question" : "questions"], [verdict, "verdict"]],
      `${overview}<section class="r-section"><h2>Question by question</h2>${detail}</section>
<section class="r-section r-keep"><h2>Revision plan</h2>${plan}</section>`);
  }

  const api = { ReportError, esc, linkCitations, tsLink, filename, conversation, exam, interview };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LMReport = api;
})(typeof window !== "undefined" ? window : globalThis);
