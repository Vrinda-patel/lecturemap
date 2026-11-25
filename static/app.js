// LectureMap – frontend (vanilla JS, no build step)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MODES = { ask: "Ask a doubt", exam: "Exam prep", interview: "Mock interview" };
const state = {
  lang: localGet("lang") || "hinglish",
  video: null,        // youtube_id or null (= whole course)
  ytVideos: [],       // [{video, title}] loaded via Beta panel
  asked: [],          // interview questions already asked
  // session data kept only in this tab, reused for PDF export (never sent to the server)
  askLog: [],         // [{q, answer, sources, source}]
  exam: null,         // {topic, notes, quiz, picks}
  interview: null,    // {topic, rounds: [{question, answer, score, feedback, ideal_answer, strengths, weaknesses, source}]}
};
let COURSE = [];

// ---------- helpers ----------
function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function md(s) { return DOMPurify.sanitize(marked.parse(s || "")); }
const isMobile = () => matchMedia("(max-width: 900px)").matches;

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const d = data && data.detail;
    throw new Error(typeof d === "string" ? d : `Kuch gadbad ho gayi (error ${res.status}). Dobara try karo.`);
  }
  return data;
}

function loading(text) {
  const el = document.createElement("div");
  el.className = "loading";
  el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>${esc(text)}`;
  return el;
}

function chip(src) {
  if (!src) return "";
  return `<button class="ts" data-vid="${esc(src.youtube_id)}" data-t="${src.start}" title="${esc(src.title)}">` +
    `<svg><use href="#i-play"/></svg>${esc(src.label)} · ${esc(src.time)}</button>`;
}

// ---------- YouTube player ----------
let player = null, playerReady = false;

function play(videoId, start) {
  if (!window.YT || !YT.Player) {  // iframe API blocked/not loaded → open on YouTube instead
    window.open(`https://www.youtube.com/watch?v=${videoId}&t=${start}s`, "_blank", "noopener");
    return;
  }
  $("#playerWrap").hidden = false;
  if (!player) {
    player = new YT.Player("player", {
      videoId, playerVars: { start, autoplay: 1, playsinline: 1, rel: 0 },
      events: { onReady: () => { playerReady = true; } },
    });
  } else if (playerReady) {
    player.loadVideoById({ videoId, startSeconds: start });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".ts");
  if (b) play(b.dataset.vid, Number(b.dataset.t));
});
$("#closePlayer").onclick = () => { if (playerReady) player.pauseVideo(); $("#playerWrap").hidden = true; };

// ---------- sidebar (mobile drawer) ----------
function sidebar(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#backdrop").classList.toggle("show", open);
}
$("#openSidebar").onclick = () => sidebar(true);
$("#closeSidebar").onclick = () => sidebar(false);
$("#backdrop").onclick = () => sidebar(false);

// ---------- mode tabs (sidebar nav on desktop, top tabs on mobile) ----------
let currentTab = "ask";
function setTab(tab) {
  currentTab = tab;
  showNewChat();
  $$("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab").forEach(t => { t.hidden = t.id !== `tab-${tab}`; });
  $("#modeLabel").textContent = MODES[tab];
  $$("[data-export]").forEach(b => { b.hidden = b.dataset.export !== EXPORT_TAB[tab]; });
  if (isMobile()) sidebar(false);
}
$$("[data-tab]").forEach(b => b.onclick = () => setTab(b.dataset.tab));

// ---------- language ----------
function renderLang() { $$("#langSeg button").forEach(b => b.classList.toggle("active", b.dataset.lang === state.lang)); }
$$("#langSeg button").forEach(b => b.onclick = () => { state.lang = b.dataset.lang; localSet("lang", state.lang); renderLang(); });
renderLang();

// ---------- sources ----------
function sourceName() {
  if (!state.video) return "All episodes · Namaste JavaScript";
  const c = COURSE.find(v => v.youtube_id === state.video);
  if (c) return `${c.label} · ${c.title}`;
  const y = state.ytVideos.find(v => v.video === state.video);
  return y ? y.title : "YouTube video";
}

function renderSources() {
  const btn = (id, tag, title, extra = "") =>
    `<button class="src ${extra} ${(state.video || "") === id ? "active" : ""}" data-src="${esc(id)}">` +
    (tag ? `<span class="tag">${esc(tag)}</span>` : "") + `<span>${esc(title)}</span></button>`;
  $("#sources").innerHTML =
    btn("", "", "All episodes", "all") + COURSE.map(v => btn(v.youtube_id, v.label, v.title)).join("");
  $("#ytSources").innerHTML = state.ytVideos.map(v => btn(v.video, "", v.title)).join("");
  $("#sourceLabel").textContent = sourceName();
  $$(".src").forEach(b => b.onclick = () => {
    state.video = b.dataset.src || null;
    state.asked = [];
    history = [];  // follow-ups shouldn't mix sources
    renderSources();
    if (isMobile()) sidebar(false);
  });
}
api("/api/videos").then(v => { COURSE = v; renderSources(); }).catch(renderSources);

// ---------- ASK ----------
const chat = $("#chat");
const EMPTY_HTML = $("#askEmpty").outerHTML;
let history = [];  // last Q/A turns, sent so follow-ups ("iska example do") work

function showNewChat() { $("#newChat").hidden = !(currentTab === "ask" && history.length); }

function newChat() {
  history = [];
  state.askLog = [];
  chat.innerHTML = EMPTY_HTML;
  $$(".samples button").forEach(b => b.onclick = () => ask(b.textContent));
  showNewChat();
}
$("#newChat").onclick = newChat;

function addMsg(cls, content) {
  $("#askEmpty")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  if (typeof content === "string") el.innerHTML = content; else el.append(content);
  chat.append(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
  return el;
}

async function ask(question) {
  addMsg("user", esc(question));
  const bot = addMsg("bot", loading("Searching the lectures…"));
  const send = $("#askForm .btn");
  send.disabled = true;
  try {
    const r = await api("/api/ask", { question, video: state.video, lang: state.lang, history: history.slice(-2) });
    history.push({ q: question, a: r.answer.slice(0, 4000) });
    state.askLog.push({ q: question, answer: r.answer, sources: r.sources, source: sourceName() });
    showNewChat();
    // turn [2] / 【2】 / [1, 3] citations into clickable timestamp chips
    let { html, cited } = LMReport.linkCitations(md(r.answer), r.sources, chip);
    const rest = r.sources.filter(s => !cited.has(s.n)).slice(0, cited.size ? 2 : 3);
    if (rest.length) html += `<div class="srcs">Also see ${rest.map(chip).join("")}</div>`;
    bot.innerHTML = html;
  } catch (e) {
    bot.classList.add("err"); bot.textContent = e.message;
  } finally { send.disabled = false; }
}

$("#askForm").onsubmit = (e) => {
  e.preventDefault();
  const q = $("#askInput").value.trim();
  if (!q) return;
  $("#askInput").value = "";
  ask(q);
};
$$(".samples button").forEach(b => b.onclick = () => ask(b.textContent));

// ---------- EXAM ----------
$("#examForm").onsubmit = async (e) => {
  e.preventDefault();
  const out = $("#examOut"), btn = $("#examForm .btn");
  out.innerHTML = ""; out.append(loading("Preparing notes and quiz…")); btn.disabled = true;
  try {
    const topic = $("#examTopic").value.trim() || null;
    const data = await api("/api/exam", { video: state.video, topic, lang: state.lang });
    state.exam = { ...data, topic, source: sourceName(), picks: data.quiz.map(() => null) };
    renderExam(data);
  } catch (err) {
    out.innerHTML = `<p class="msg err">${esc(err.message)}</p>`;
  } finally { btn.disabled = false; }
};

function renderExam({ notes, quiz }) {
  const out = $("#examOut");
  let score = 0, answered = 0;
  out.innerHTML =
    `<div class="card"><h3>Revision notes</h3>` +
    notes.map((n, i) => `<div class="note"><span class="num">${i + 1}</span><div>${esc(n.point)} ${chip(n.source)}</div></div>`).join("") +
    `</div><div class="card"><h3>Quiz</h3><div id="quiz"></div></div><div id="scoreCard"></div>`;

  quiz.forEach((q, qi) => {
    const el = document.createElement("div");
    el.className = "q";
    el.innerHTML = `<div class="qtext">${qi + 1}. ${md(q.q).replace(/^<p>/, "")}</div>` +
      q.options.map((o, oi) => `<button class="opt" data-i="${oi}">${esc(o)}</button>`).join("") +
      `<div class="explain" hidden></div>`;
    $$(".opt", el).forEach(b => b.onclick = () => {
      const pick = Number(b.dataset.i), ok = pick === q.answer;
      if (state.exam && state.exam.quiz === quiz) state.exam.picks[qi] = pick;
      $$(".opt", el).forEach((x, i) => {
        x.disabled = true;
        if (i === q.answer) x.classList.add("right");
        else if (i === pick) x.classList.add("wrong");
      });
      const ex = $(".explain", el);
      ex.hidden = false;
      ex.innerHTML = (ok ? `<b class="ok">Correct.</b> ` : `<b class="no">Not quite.</b> `) + esc(q.explain) + (q.source ? ` ${chip(q.source)}` : "");
      answered++; if (ok) score++;
      if (answered === quiz.length) {
        const msg = score === quiz.length ? "Full marks — you're exam ready." : score >= 3 ? "Good job. Revise the ones you missed using the timestamps." : "Revise from the timestamps above, then try a new quiz.";
        $("#scoreCard").innerHTML = `<div class="card score"><span class="big">${score}/${quiz.length}</span><p>${msg}</p><button class="btn ghost" id="again">New quiz</button></div>`;
        $("#again").onclick = () => $("#examForm").requestSubmit();
      }
    });
    $("#quiz").append(el);
  });
}

// ---------- INTERVIEW ----------
$("#ivStartForm").onsubmit = (e) => {
  e.preventDefault();
  state.asked = [];
  state.interview = { topic: $("#ivTopic").value.trim() || null, source: sourceName(), rounds: [] };
  nextQuestion();
};

async function nextQuestion() {
  const out = $("#ivOut");
  out.innerHTML = ""; out.append(loading("Preparing a question…"));
  try {
    const r = await api("/api/interview/question", {
      video: state.video, topic: $("#ivTopic").value.trim() || null, lang: state.lang, asked: state.asked,
    });
    state.asked.push(r.question);
    out.innerHTML = `<div class="card">
      <div class="label">Question ${state.asked.length}</div>
      <p class="iv-q">${esc(r.question)}</p>
      <textarea id="ivAnswer" placeholder="Type your answer as you would say it in an interview…"></textarea>
      <div class="actions" style="margin-top:0"><button class="btn" id="ivSubmit">Submit answer</button><button class="btn ghost" id="ivSkip">I don't know</button></div>
    </div><div id="ivResult"></div>`;
    $("#ivSubmit").onclick = () => grade(r.question, $("#ivAnswer").value.trim());
    $("#ivSkip").onclick = () => grade(r.question, "");
  } catch (err) {
    out.innerHTML = `<p class="msg err">${esc(err.message)}</p>`;
  }
}

async function grade(question, answer) {
  const res = $("#ivResult");
  $("#ivSubmit").disabled = $("#ivSkip").disabled = true;
  res.innerHTML = ""; res.append(loading("Evaluating your answer…"));
  try {
    const r = await api("/api/interview/grade", { question, answer, video: state.video, lang: state.lang });
    state.interview?.rounds.push({ question, answer, ...r });
    const color = r.score >= 7 ? "var(--good)" : r.score >= 4 ? "var(--accent)" : "var(--bad)";
    const points = (items, cls) => items?.length ? `<ul class="points ${cls}">${items.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : "";
    res.innerHTML = `<div class="card">
      <div class="result-head"><div class="ring" style="color:${color}">${r.score}</div><div>${md(r.feedback)}</div></div>
      ${points(r.strengths, "good")}${points(r.weaknesses, "bad")}
      <div class="label">Ideal answer</div><div>${md(r.ideal_answer)}</div>
      ${r.source ? `<div class="label">Revise</div>${chip(r.source)}` : ""}
      <div class="actions"><button class="btn" id="ivNext">Next question</button></div>
    </div>`;
    $("#ivNext").onclick = nextQuestion;
  } catch (err) {
    res.innerHTML = `<p class="msg err">${esc(err.message)}</p>`;
    $("#ivSubmit").disabled = $("#ivSkip").disabled = false;
  }
}

// ---------- YouTube Beta ----------
$("#ytToggle").onclick = () => { $("#ytPanel").hidden = !$("#ytPanel").hidden; if (!$("#ytPanel").hidden) $("#ytUrl").focus(); };
$("#ytForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("#ytMsg"), btn = $("#ytForm .btn");
  msg.textContent = "Fetching captions… this can take up to 30 seconds.";
  btn.disabled = true;
  try {
    const r = await api("/api/youtube", { url: $("#ytUrl").value.trim() });
    if (!r.course && !state.ytVideos.some(v => v.video === r.video)) state.ytVideos.unshift({ video: r.video, title: r.title });
    state.video = r.video; state.asked = []; history = [];
    renderSources();
    msg.textContent = "Ready. Ask, prep or interview on this video.";
    $("#ytUrl").value = "";
  } catch (err) {
    msg.textContent = err.message;
  } finally { btn.disabled = false; }
};

// ---------- PDF export (built in the browser from the session data above; Save as PDF via the print dialog) ----------
const EXPORT_TAB = { ask: "conversation", exam: "exam", interview: "interview" };
// in-app browsers (Instagram, Facebook, Android WebView…) silently ignore window.print()
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|; wv\)/i;
let toastTimer;

function toast(text, isErr = false) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("err", isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 7000 : 4500);
}

function buildReport(kind) {
  const meta = {
    date: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    lang: state.lang === "english" ? "English" : "Hinglish",
  };
  const opts = { md };  // md() sanitises AI markdown with DOMPurify
  if (kind === "conversation") return LMReport.conversation(state.askLog, { ...meta, source: state.askLog[0]?.source }, opts);
  if (kind === "exam") return LMReport.exam(state.exam, { ...meta, source: state.exam?.source }, opts);
  return LMReport.interview(state.interview, { ...meta, source: state.interview?.source }, opts);
}

async function exportPdf(btn) {
  if (btn.disabled) return;
  let html;
  try {
    html = buildReport(btn.dataset.export);
  } catch (e) {
    toast(e instanceof LMReport.ReportError ? e.message : "PDF nahi ban paayi. Page refresh karke dobara try karo.", true);
    if (!(e instanceof LMReport.ReportError)) console.error(e);
    return;
  }
  if (IN_APP.test(navigator.userAgent) || typeof window.print !== "function") {
    toast("Is app ka browser PDF save nahi karta. Link ko Chrome ya Safari mein kholo, phir download karo.", true);
    return;
  }
  const label = btn.innerHTML, title = document.title;
  btn.disabled = true;
  btn.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>Preparing PDF…`;
  const root = document.documentElement;
  $("#printRoot").innerHTML = html;  // replaces any previous report
  root.classList.add("print-report");
  document.title = LMReport.filename(btn.dataset.export);  // becomes the suggested file name
  const resetButton = () => { btn.disabled = false; btn.innerHTML = label; };
  const cleanup = () => {
    resetButton();
    // wait a moment: mobile browsers may still be reading the page right after afterprint
    setTimeout(() => { document.title = title; root.classList.remove("print-report"); $("#printRoot").innerHTML = ""; }, 1500);
  };
  try {
    await document.fonts?.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    toast("Print window mein “Save as PDF” chuno.");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    // some browsers never fire afterprint: free the button, keep the report until the next export
    setTimeout(() => { resetButton(); document.title = title; }, 4000);
  } catch (e) {
    console.error(e);
    window.removeEventListener("afterprint", cleanup);
    toast("PDF nahi ban paayi. Dobara try karo.", true);
    cleanup();
  }
}
$$("[data-export]").forEach(b => b.onclick = () => exportPdf(b));
