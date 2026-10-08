"use strict";

(() => {

/* =========================================================
   기본 설정
========================================================= */

const HOME = "https://semicolonxss.github.io/Formwheel/";

const firebaseConfig = {
  apiKey: "AIzaSyBreTSe1m0-xlbF4aupnU5isRZCihR25IE",
  authDomain: "formwheel.firebaseapp.com",
  databaseURL: "https://formwheel-default-rtdb.firebaseio.com/",
  projectId: "formwheel",
  storageBucket: "formwheel.firebasestorage.app",
  messagingSenderId: "431583088241",
  appId: "1:431583088241:web:74e0e34ea1e3e1170c55d0"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/*
  Battle 상태
  waiting    = 로비
  countdown  = 시작 카운트다운
  playing    = 문제 풀이
  result     = 라운드 결과
  finished   = 최종 결과
*/
const PHASE = {
  WAITING: "waiting",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  RESULT: "result",
  FINISHED: "finished"
};

const DEFAULT_QUESTIONS = [
  {
    text:"다음 중 대한민국의 수도는 어디일까요?",
    choices:["부산","서울","인천","대구"],
    correct:1
  },
  {
    text:"물의 화학식은 무엇일까요?",
    choices:["CO₂","O₂","H₂O","NaCl"],
    correct:2
  },
  {
    text:"태양계에서 가장 큰 행성은?",
    choices:["지구","목성","화성","토성"],
    correct:1
  },
  {
    text:"평년의 1년은 며칠일까요?",
    choices:["364일","365일","366일","360일"],
    correct:1
  }
];

const SESSION_KEY = "formwheel_battle_session_v3";

/* =========================================================
   로컬 상태
========================================================= */

let screen = "home";

let pin = "";
let playerId = "";
let playerName = "";
let role = "";

let mode = "1v1";
let teamSize = 2;
let myTeam = "A";

let timeLimit = 10;
let questionIndex = 0;

let questions = DEFAULT_QUESTIONS.slice();
let selectedQuizId = "";

let listeners = [];
let timer = null;
let stateData = null;

let submitted = false;
let countdownShown = -1;
let renderToken = 0;

/* =========================================================
   유틸
========================================================= */

function esc(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[c]));
}

function randomId(){
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makePin(){
  return String(Math.floor(1000 + Math.random() * 9000));
}

function clearTimer(){
  if(timer){
    clearInterval(timer);
    timer = null;
  }
}

function removeListeners(){
  listeners.forEach(fn => {
    try{ fn(); }catch(_){}
  });
  listeners = [];
}

function cleanup(){
  clearTimer();
  removeListeners();
}

function battleRef(){
  return db.ref("battle/" + pin);
}

function playersRef(){
  return battleRef().child("players");
}

function stateRef(){
  return battleRef().child("state");
}

function currentQuestion(){
  return questions[questionIndex] || DEFAULT_QUESTIONS[0];
}

function saveSession(){
  if(!pin || !playerId) return;

  localStorage.setItem(SESSION_KEY, JSON.stringify({
    pin,
    playerId,
    playerName,
    role,
    mode,
    teamSize,
    myTeam,
    timeLimit,
    questionIndex,
    selectedQuizId
  }));
}

function loadSession(){
  try{
    const data = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return data || null;
  }catch(_){
    return null;
  }
}

function clearSession(){
  localStorage.removeItem(SESSION_KEY);
}

function openHome(){
  window.location.href = HOME;
}

function isTeam(){
  return mode === "team";
}

function getPlayersArray(value){
  return Object.entries(value || {}).map(([id,p]) => ({
    id,
    ...(p || {})
  }));
}

function teamCounts(players){
  return {
    A: players.filter(p => p.team === "A").length,
    B: players.filter(p => p.team === "B").length
  };
}

function autoTeam(players){
  const c = teamCounts(players);

  if(c.A >= teamSize && c.B >= teamSize) return null;

  if(c.A <= c.B && c.A < teamSize) return "A";
  if(c.B < teamSize) return "B";

  return "A";
}

function teamScore(players, team){
  return players
    .filter(p => p.team === team)
    .reduce((sum,p) => sum + Number(p.score || 0), 0);
}

function allAnswered(players, round){
  if(players.length < (isTeam() ? 2 : 2)) return false;

  return players.every(p =>
    p.answers &&
    p.answers[String(round)] &&
    p.answers[String(round)].submitted === true
  );
}

/* =========================================================
   화면 공통
========================================================= */

function navbar(meta = ""){
  return `
    <div class="navbar">
      <button class="brand fw-hub-logo" id="brandBtn" aria-label="FormWheel 메인으로 이동"><span class="fw-hub-form">Form</span><span class="fw-hub-icon" aria-hidden="true"></span><span class="fw-hub-wheel">Wheel</span></button>
      <span class="nav-meta">${meta}</span>
    </div>
  `;
}

function bindBrand(){
  const btn = document.getElementById("brandBtn");
  if(btn) btn.onclick = openHome;
}

function setScreen(next){
  cleanup();
  screen = next;
  render();
}

function render(){
  renderToken++;

  if(screen === "home") renderHome();
  else if(screen === "setup") renderSetup();
  else if(screen === "hostLobby") renderHostLobby();
  else if(screen === "join") renderJoin();
  else if(screen === "playerLobby") renderPlayerLobby();
  else if(screen === "countdown") renderCountdown();
  else if(screen === "playing") renderPlaying();
  else if(screen === "result") renderResult();
  else if(screen === "finished") renderFinished();

  bindBrand();
}

/* =========================================================
   HOME
========================================================= */

function renderHome(){

  document.getElementById("app").innerHTML =
    navbar() +
    `
    <main>
      <div class="stage">

        <h1 class="title">Battle</h1>
        <p class="sub">
          Quiz를 이용해서 친구와 실시간으로 대결해보세요.
        </p>

        <div class="home-choice">

          <button class="home-card" id="createBattle">
            <h3>⚔️ Battle 만들기</h3>
            <p>Quiz와 제한 시간을 선택하고 Battle을 만들어보세요.</p>
          </button>

          <button class="home-card" id="joinBattle">
            <h3>🚪 Battle 참가하기</h3>
            <p>친구에게 받은 4자리 코드로 참가합니다.</p>
          </button>

        </div>

      </div>
    </main>
    `;

  document.getElementById("createBattle").onclick = () => {
    role = "host";
    renderSetup();
  };

  document.getElementById("joinBattle").onclick = () => {
    role = "player";
    renderJoin();
  };
}

/* =========================================================
   SETUP
========================================================= */

async function renderSetup(){

  screen = "setup";

  document.getElementById("app").innerHTML =
    navbar() +
    `
    <main>
      <div class="stage">

        <h1 class="title">Battle 만들기</h1>
        <p class="sub">
          Quiz와 Battle 방식을 선택하세요.
        </p>

        <div class="card">

          <div class="field">
            <label>내 닉네임</label>
            <input
              id="hostName"
              type="text"
              maxlength="12"
              placeholder="닉네임을 입력해주세요"
            >
          </div>

          <div class="field">
            <label>Quiz</label>
            <select id="quizSelect">
              <option>불러오는 중...</option>
            </select>
          </div>

          <div class="field">
            <label>Battle 방식</label>
            <div class="mode-row">
              <button class="mode active" data-mode="1v1">⚔️ 1 vs 1</button>
              <button class="mode" data-mode="team">👥 팀전</button>
            </div>
          </div>

          <div
            class="field"
            id="teamSizeField"
            style="display:none"
          >
            <label>팀당 인원</label>

            <div class="mode-row">
              <button class="mode active" data-team="2">2 vs 2</button>
              <button class="mode" data-team="3">3 vs 3</button>
              <button class="mode" data-team="4">4 vs 4</button>
            </div>
          </div>

          <div class="field">
            <label>문제당 제한 시간</label>

            <div class="mode-row">
              <button class="mode active" data-time="10">10초</button>
              <button class="mode" data-time="15">15초</button>
              <button class="mode" data-time="20">20초</button>
              <button class="mode" data-time="30">30초</button>
            </div>
          </div>

          <div class="note" id="quizInfo">
            Quiz 목록을 불러오는 중입니다.
          </div>

          <button class="btn" id="createBtn">
            ⚔️ Battle 만들기
          </button>

          <div class="error" id="setupError"></div>

        </div>

      </div>
    </main>
    `;

  bindBrand();

  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;

      document.querySelectorAll("[data-mode]").forEach(b =>
        b.classList.toggle("active", b === btn)
      );

      document.getElementById("teamSizeField").style.display =
        mode === "team" ? "" : "none";
    };
  });

  document.querySelectorAll("[data-team]").forEach(btn => {
    btn.onclick = () => {
      teamSize = Number(btn.dataset.team);

      document.querySelectorAll("[data-team]").forEach(b =>
        b.classList.toggle("active", b === btn)
      );
    };
  });

  document.querySelectorAll("[data-time]").forEach(btn => {
    btn.onclick = () => {
      timeLimit = Number(btn.dataset.time);

      document.querySelectorAll("[data-time]").forEach(b =>
        b.classList.toggle("active", b === btn)
      );
    };
  });

  await loadQuizList();

  const createBtn = document.getElementById("createBtn");

  createBtn.onclick = createBattle;
}

/* =========================================================
   QUIZ 목록
========================================================= */

async function loadQuizList(){

  const select = document.getElementById("quizSelect");
  const info = document.getElementById("quizInfo");

  if(!select) return;

  let list = [];

  try{

    const snap = await db.ref("quizzes").once("value");
    const value = snap.val() || {};

    list = Object.entries(value).map(([id,q]) => ({
      id,
      ...(q || {})
    }));

  }catch(error){

    console.error(error);
  }

  if(list.length === 0){

    questions = DEFAULT_QUESTIONS.slice();
    selectedQuizId = "";

    select.innerHTML =
      `<option value="">🧠 기본 Quiz — ${questions.length}문제</option>`;

    info.textContent =
      "저장된 Quiz가 없어 기본 Quiz를 사용합니다.";

    return;
  }

  select.innerHTML =
    list.map(q => `
      <option value="${esc(q.id)}">
        📝 ${esc(q.title || "제목 없는 Quiz")}
        — ${(q.questions || []).length}문제
      </option>
    `).join("") +
    `<option value="">🧠 기본 Quiz — ${DEFAULT_QUESTIONS.length}문제</option>`;

  const first = list[0];

  selectedQuizId = first.id;
  questions = Array.isArray(first.questions) && first.questions.length
    ? first.questions
    : DEFAULT_QUESTIONS.slice();

  info.textContent =
    `현재 선택: ${first.title || "제목 없는 Quiz"} · ${questions.length}문제`;

  select.onchange = () => {

    const selected = list.find(q => q.id === select.value);

    if(!selected){

      selectedQuizId = "";
      questions = DEFAULT_QUESTIONS.slice();

      info.textContent =
        `기본 Quiz · ${questions.length}문제`;

      return;
    }

    selectedQuizId = selected.id;

    questions =
      Array.isArray(selected.questions) && selected.questions.length
      ? selected.questions
      : DEFAULT_QUESTIONS.slice();

    info.textContent =
      `현재 선택: ${selected.title || "제목 없는 Quiz"} · ${questions.length}문제`;
  };
}

/* =========================================================
   방 생성
========================================================= */

async function createBattle(){

  const nameInput = document.getElementById("hostName");
  const error = document.getElementById("setupError");

  const name = nameInput.value.trim();

  if(!name){
    error.textContent = "닉네임을 입력해주세요.";
    return;
  }

  if(!questions.length){
    error.textContent = "사용할 문제가 없습니다.";
    return;
  }

  const btn = document.getElementById("createBtn");

  btn.disabled = true;
  btn.textContent = "Battle 생성 중...";

  try{

    let newPin = "";

    for(let i=0;i<10;i++){

      const candidate = makePin();
      const snap = await db.ref("battle/" + candidate).once("value");

      if(!snap.exists()){
        newPin = candidate;
        break;
      }
    }

    if(!newPin){
      throw new Error("방 코드를 생성하지 못했습니다.");
    }

    pin = newPin;
    playerId = randomId();
    playerName = name;
    role = "host";
    myTeam = "A";
    questionIndex = 0;

    const player = {
      name,
      role:"host",
      team:mode === "team" ? "A" : null,
      score:0,
      connected:true,
      joinedAt:firebase.database.ServerValue.TIMESTAMP,
      lastSeenAt:firebase.database.ServerValue.TIMESTAMP
    };

    const roomData = {

      meta:{
        hostId:playerId,
        hostName:name,
        mode,
        teamSize:mode === "team" ? teamSize : null,
        timeLimit,
        quizId:selectedQuizId,
        questionCount:questions.length,
        questions:questions
      },

      state:{
        phase:PHASE.WAITING,
        round:-1,
        countdownEndsAt:0,
        roundStartedAt:0,
        roundEndsAt:0,
        resultEndsAt:0,
        updatedAt:firebase.database.ServerValue.TIMESTAMP
      },

      players:{
        [playerId]:player
      }

    };

    await db.ref("battle/" + pin).set(roomData);

    saveSession();

    screen = "hostLobby";
    render();

    subscribeRoom();

  }catch(errorObj){

    console.error(errorObj);

    error.textContent =
      "Battle 생성 실패: " + errorObj.message;

    btn.disabled = false;
    btn.textContent = "⚔️ Battle 만들기";
  }
}

/* =========================================================
   HOST LOBBY
========================================================= */

function renderHostLobby(){

  document.getElementById("app").innerHTML =
    navbar(`코드 <b>${pin}</b>`) +
    `
    <main>
      <div class="stage wide">

        <div class="pin-box">
          <div class="plabel">Battle 참가 코드</div>
          <div class="pin">${pin}</div>
        </div>

        <p class="sub" style="text-align:center">
          친구에게 코드를 알려주세요.
          참가하면 자동으로 표시됩니다.
        </p>

        <div id="lobbyContent"></div>

        <div class="actions">

          <button class="btn" id="startBattle" disabled>
            참가자를 기다리는 중...
          </button>

          <button class="btn ghost" id="leaveBattle">
            방 나가기
          </button>

        </div>

        <div class="error" id="lobbyError"></div>

      </div>
    </main>
    `;

  document.getElementById("leaveBattle").onclick =
    () => leaveRoom(true);

  subscribeRoom();
}

/* =========================================================
   JOIN
========================================================= */

function renderJoin(){

  document.getElementById("app").innerHTML =
    navbar() +
    `
    <main>
      <div class="stage">

        <h1 class="title">Battle 참가하기</h1>
        <p class="sub">
          친구에게 받은 코드와 닉네임을 입력하세요.
        </p>

        <div class="card">

          <div class="field">
            <label>Battle 코드</label>
            <input
              id="joinPin"
              type="tel"
              maxlength="4"
              inputmode="numeric"
              placeholder="예: 4821"
            >
          </div>

          <div class="field">
            <label>닉네임</label>
            <input
              id="joinName"
              type="text"
              maxlength="12"
              placeholder="닉네임"
            >
          </div>

          <button class="btn" id="joinBtn">
            🚪 참가하기
          </button>

          <div class="error" id="joinError"></div>

          <button
            class="btn ghost"
            id="joinBack"
            style="margin-top:10px"
          >
            뒤로가기
          </button>

        </div>

      </div>
    </main>
    `;

  document.getElementById("joinBack").onclick =
    () => setScreen("home");

  document.getElementById("joinBtn").onclick =
    joinBattle;
}

/* =========================================================
   방 참가
========================================================= */

async function joinBattle(){

  const pinInput = document.getElementById("joinPin");
  const nameInput = document.getElementById("joinName");
  const error = document.getElementById("joinError");
  const btn = document.getElementById("joinBtn");

  const code = pinInput.value.trim();
  const name = nameInput.value.trim();

  if(!/^\d{4}$/.test(code)){
    error.textContent = "4자리 Battle 코드를 입력해주세요.";
    return;
  }

  if(!name){
    error.textContent = "닉네임을 입력해주세요.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "참가 중...";

  try{

    const roomSnap =
      await db.ref("battle/" + code).once("value");

    if(!roomSnap.exists()){
      throw new Error("존재하지 않는 Battle입니다.");
    }

    const room = roomSnap.val();

    const phase =
      room.state?.phase || PHASE.WAITING;

    if(phase !== PHASE.WAITING){
      throw new Error("이미 시작된 Battle입니다.");
    }

    const players = getPlayersArray(room.players);

    mode =
      room.meta?.mode === "team"
      ? "team"
      : "1v1";

    teamSize =
      Number(room.meta?.teamSize || 2);

    if(mode === "1v1"){

      if(players.some(p => p.role === "player")){
        throw new Error("이미 상대 플레이어가 참가했습니다.");
      }

    }else{

      const team = autoTeam(players);

      if(!team){
        throw new Error("Battle 인원이 가득 찼습니다.");
      }

      myTeam = team;
    }

    pin = code;
    playerId = randomId();
    playerName = name;
    role = "player";

    timeLimit =
      Number(room.meta?.timeLimit || 10);

    questions =
      Array.isArray(room.meta?.questions) &&
      room.meta.questions.length
      ? room.meta.questions
      : DEFAULT_QUESTIONS.slice();

    questionIndex = 0;

    const player = {
      name,
      role:"player",
      team:mode === "team" ? myTeam : null,
      score:0,
      connected:true,
      joinedAt:firebase.database.ServerValue.TIMESTAMP,
      lastSeenAt:firebase.database.ServerValue.TIMESTAMP
    };

    await db.ref(
      "battle/" + pin + "/players/" + playerId
    ).set(player);

    saveSession();

    screen = "playerLobby";
    render();

    subscribeRoom();

  }catch(errorObj){

    error.textContent =
      errorObj.message;

    btn.disabled = false;
    btn.textContent = "🚪 참가하기";
  }
}

/* =========================================================
   PLAYER LOBBY
========================================================= */

function renderPlayerLobby(){

  document.getElementById("app").innerHTML =
    navbar(`코드 <b>${pin}</b>`) +
    `
    <main>
      <div class="stage wide">

        <div class="center">

          <div class="status-pill">
            ● WAITING
          </div>

          <div class="big">
            ${isTeam() ? (myTeam === "A" ? "🔥" : "💧") : "⚔️"}
          </div>

          <h1 class="title">
            ${esc(playerName)}님, 참가 완료!
          </h1>

          <p class="sub">
            진행자가 Battle을 시작하면
            자동으로 카운트다운이 시작됩니다.
          </p>

        </div>

        <div id="lobbyContent"></div>

        <button class="btn ghost" id="leaveBattle">
          방 나가기
        </button>

      </div>
    </main>
    `;

  document.getElementById("leaveBattle").onclick =
    () => leaveRoom(true);

  subscribeRoom();
}

/* =========================================================
   방 실시간 동기화
========================================================= */

function subscribeRoom(){

  cleanup();

  if(!pin || !playerId) return;

  const roomRef = battleRef();

  const callback = snap => {

    if(!snap.exists()){

      clearSession();

      if(screen !== "home"){
        screen = "home";
        render();
      }

      return;
    }

    const room = snap.val();

    stateData = room.state || {};

    const meta = room.meta || {};

    if(meta.mode){
      mode = meta.mode;
    }

    if(meta.teamSize){
      teamSize = Number(meta.teamSize);
    }

    if(meta.timeLimit){
      timeLimit = Number(meta.timeLimit);
    }

    if(Array.isArray(meta.questions) && meta.questions.length){
      questions = meta.questions;
    }

    const me = room.players?.[playerId];

    if(!me){

      clearSession();

      screen = "home";
      render();

      return;
    }

    if(me.team){
      myTeam = me.team;
    }

    saveSession();

    syncLobby(room);

    syncPhase(room);
  };

  roomRef.on("value", callback);

  listeners.push(() =>
    roomRef.off("value", callback)
  );
}

/* =========================================================
   로비 UI 동기화
========================================================= */

function syncLobby(room){

  const target =
    document.getElementById("lobbyContent");

  if(!target) return;

  const players =
    getPlayersArray(room.players);

  if(isTeam()){

    target.innerHTML =
      renderTeamGrid(players);

  }else{

    const host =
      players.find(p => p.role === "host");

    const opponent =
      players.find(p => p.role === "player");

    target.innerHTML = `
      <div class="player-grid">

        <div class="player-card red">
          <div class="player-icon">🔥</div>
          <div class="player-name">
            ${esc(host?.name || "진행자")}
          </div>
          <div class="score">
            ${host?.score || 0}
          </div>
        </div>

        <div class="player-card cyan">
          <div class="player-icon">💧</div>
          <div class="player-name">
            ${esc(opponent?.name || "상대를 기다리는 중")}
          </div>
          <div class="score">
            ${opponent ? opponent.score || 0 : "—"}
          </div>
        </div>

      </div>
    `;
  }

  const start =
    document.getElementById("startBattle");

  if(start){

    const canStart =
      isTeam()
      ? players.some(p => p.team === "A") &&
        players.some(p => p.team === "B")
      : players.filter(p => p.role === "player").length === 1;

    start.disabled = !canStart;

    start.textContent =
      canStart
      ? "⚔️ Battle 시작하기"
      : "참가자를 기다리는 중...";

    start.onclick =
      startBattle;
  }
}

function renderTeamGrid(players){

  const a =
    players.filter(p => p.team === "A");

  const b =
    players.filter(p => p.team === "B");

  const member = p => `
    <div class="team-member ${p.id === playerId ? "me" : ""}">
      <span>
        ${p.role === "host" ? "👑 " : ""}
        ${esc(p.name)}
      </span>
      <span>${Number(p.score || 0)}점</span>
    </div>
  `;

  return `
    <div class="team-grid">

      <div class="team-col red">

        <div class="team-icon">🔥</div>

        <div class="team-title">
          팀 A · ${a.length}/${teamSize}
        </div>

        <div class="team-score">
          ${teamScore(players,"A")}
        </div>

        <div class="team-members">
          ${
            a.length
            ? a.map(member).join("")
            : `<div class="team-empty">아직 팀원이 없습니다.</div>`
          }
        </div>

      </div>

      <div class="team-col cyan">

        <div class="team-icon">💧</div>

        <div class="team-title">
          팀 B · ${b.length}/${teamSize}
        </div>

        <div class="team-score">
          ${teamScore(players,"B")}
        </div>

        <div class="team-members">
          ${
            b.length
            ? b.map(member).join("")
            : `<div class="team-empty">아직 팀원이 없습니다.</div>`
          }
        </div>

      </div>

    </div>
  `;
}

/* =========================================================
   상태 머신 동기화
========================================================= */

function syncPhase(room){

  const state =
    room.state || {};

  const phase =
    state.phase || PHASE.WAITING;

  const round =
    Number(state.round ?? -1);

  if(
    phase === PHASE.WAITING
  ){
    questionIndex = Math.max(0,round);

    if(role === "host" && screen !== "hostLobby"){
      screen = "hostLobby";
      render();
    }

    if(role === "player" && screen !== "playerLobby"){
      screen = "playerLobby";
      render();
    }

    return;
  }

  if(
    phase === PHASE.COUNTDOWN
  ){

    questionIndex = Math.max(0,round);

    if(screen !== "countdown"){
      screen = "countdown";
      render();
    }

    updateCountdown(state);

    return;
  }

  if(
    phase === PHASE.PLAYING
  ){

    questionIndex = Math.max(0,round);

    if(screen !== "playing"){
      submitted = false;
      screen = "playing";
      render();
    }

    updatePlayingTimer(state);

    return;
  }

  if(
    phase === PHASE.RESULT
  ){

    questionIndex = Math.max(0,round);

    if(screen !== "result"){
      screen = "result";
      render();
    }

    return;
  }

  if(
    phase === PHASE.FINISHED
  ){

    if(screen !== "finished"){
      screen = "finished";
      render();
    }

    return;
  }
}

/* =========================================================
   Battle 시작
========================================================= */

async function startBattle(){

  if(role !== "host") return;

  const snap =
    await playersRef().once("value");

  const players =
    getPlayersArray(snap.val());

  if(
    isTeam()
    ? !players.some(p => p.team === "A") ||
      !players.some(p => p.team === "B")
    : players.filter(p => p.role === "player").length !== 1
  ){
    return;
  }

  const now = Date.now();

  await stateRef().set({

    phase:PHASE.COUNTDOWN,

    round:0,

    countdownEndsAt:now + 3000,

    roundStartedAt:0,

    roundEndsAt:0,

    resultEndsAt:0,

    updatedAt:firebase.database.ServerValue.TIMESTAMP

  });
}

/* =========================================================
   COUNTDOWN
========================================================= */

function renderCountdown(){

  document.getElementById("app").innerHTML =
    navbar(`코드 <b>${pin}</b>`) +
    `
    <main>
      <div class="stage">

        <div class="countdown">

          <div class="status-pill">
            ● COUNTDOWN
          </div>

          <div
            class="countdown-number"
            id="countdownNumber"
          >
            3
          </div>

          <p class="sub">
            곧 문제가 시작됩니다.
          </p>

        </div>

      </div>
    </main>
    `;

  updateCountdown(stateData || {});
}

function updateCountdown(state){

  const end =
    Number(state.countdownEndsAt || 0);

  if(!end) return;

  clearTimer();

  const tick = async () => {

    const remain =
      Math.max(
        0,
        end - Date.now()
      );

    const number =
      Math.ceil(remain / 1000);

    const el =
      document.getElementById("countdownNumber");

    if(el){

      el.textContent =
        number > 0
        ? number
        : "GO!";

      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "pop .7s ease";
    }

    if(remain <= 0){

      clearTimer();

      if(role === "host"){

        const snap =
          await stateRef().once("value");

        const current =
          snap.val() || {};

        if(
          current.phase === PHASE.COUNTDOWN &&
          Number(current.round) === Number(state.round)
        ){

          const now = Date.now();

          await stateRef().update({

            phase:PHASE.PLAYING,

            roundStartedAt:now,

            roundEndsAt:now + timeLimit * 1000,

            updatedAt:firebase.database.ServerValue.TIMESTAMP

          });

        }

      }

    }

  };

  tick();

  timer =
    setInterval(tick,100);
}

/* =========================================================
   PLAYING
========================================================= */

function renderPlaying(){

  submitted = false;

  const q = currentQuestion();

  document.getElementById("app").innerHTML =
    navbar(`코드 <b>${pin}</b>`) +
    `
    <main>
      <div class="stage wide">

        <div class="topbar">

          <span class="mini">
            ROUND ${questionIndex + 1} / ${questions.length}
          </span>

          <span
            class="mini"
            id="scoreText"
          >
            점수 불러오는 중...
          </span>

        </div>

        <div class="timer-row">

          <div class="timer-track">
            <div
              class="timer-fill"
              id="timerFill"
              style="width:100%"
            ></div>
          </div>

          <div
            class="timer-num"
            id="timerNumber"
          >
            ${timeLimit}s
          </div>

        </div>

        <div class="progress-dots">
          ${
            questions.map((_,i) => `
              <span class="
                progress-dot
                ${i < questionIndex ? "done" : ""}
                ${i === questionIndex ? "current" : ""}
              "></span>
            `).join("")
          }
        </div>

        <div class="card">

          <h2 class="qtext">
            ${esc(q.text)}
          </h2>

          <div
            class="choices-grid"
            id="choices"
          >
            ${
              q.choices.map((choice,i) => `
                <button
                  class="choice ${["a","b","c","d"][i] || "a"}"
                  data-index="${i}"
                >
                  ${esc(choice)}
                </button>
              `).join("")
            }
          </div>

          <div
            class="note"
            id="answerStatus"
            style="margin-top:15px;text-align:center"
          >
            정답을 선택하세요.
          </div>

        </div>

        <div class="leave">
          페이지를 닫거나 나가면 자동으로 퇴장 처리됩니다.
        </div>

      </div>
    </main>
    `;

  document.querySelectorAll("[data-index]").forEach(btn => {

    btn.onclick = () =>
      submitAnswer(Number(btn.dataset.index));

  });

  updateScoreUI();
  updatePlayingTimer(stateData || {});
}

/* =========================================================
   PLAYING 타이머
========================================================= */

function updatePlayingTimer(state){

  const end =
    Number(state.roundEndsAt || 0);

  if(!end) return;

  clearTimer();

  const tick = async () => {

    const remainMs =
      Math.max(
        0,
        end - Date.now()
      );

    const remain =
      Math.ceil(remainMs / 1000);

    const percent =
      Math.max(
        0,
        Math.min(
          100,
          remainMs / (timeLimit * 1000) * 100
        )
      );

    const fill =
      document.getElementById("timerFill");

    const number =
      document.getElementById("timerNumber");

    if(fill){
      fill.style.width = percent + "%";

      if(remain <= 5){
        fill.classList.add("urgent");
      }
    }

    if(number){

      number.textContent =
        remain + "s";

      if(remain <= 5){
        number.classList.add("urgent");
      }
    }

    if(remainMs <= 0){

      clearTimer();

      if(!submitted){
        await submitAnswer(-1);
      }

      if(role === "host"){
        await tryFinishRound();
      }

    }

  };

  tick();

  timer =
    setInterval(tick,100);
}

/* =========================================================
   점수 표시
========================================================= */

async function updateScoreUI(){

  try{

    const snap =
      await playersRef().once("value");

    const players =
      getPlayersArray(snap.val());

    const el =
      document.getElementById("scoreText");

    if(!el) return;

    if(isTeam()){

      el.textContent =
        `🔥 ${teamScore(players,"A")} : ${teamScore(players,"B")} 💧`;

    }else{

      const me =
        players.find(p => p.id === playerId);

      const opponent =
        players.find(p => p.id !== playerId);

      el.textContent =
        `${me?.score || 0} : ${opponent?.score || 0}`;

    }

  }catch(_){}
}

/* =========================================================
   답변 제출
========================================================= */

async function submitAnswer(answerIndex){

  if(submitted) return;

  submitted = true;

  clearTimer();

  const q = currentQuestion();

  const correct =
    answerIndex >= 0 &&
    answerIndex === Number(q.correct);

  const buttons =
    document.querySelectorAll("[data-index]");

  buttons.forEach(btn => {

    btn.disabled = true;

    if(
      Number(btn.dataset.index) !== answerIndex
    ){
      btn.classList.add("dim");
    }else{
      btn.classList.add("picked");
    }

  });

  const status =
    document.getElementById("answerStatus");

  if(status){
    status.textContent =
      answerIndex < 0
      ? "시간이 끝났습니다."
      : correct
        ? "정답 제출 완료!"
        : "답변 제출 완료!";
  }

  try{

    /*
      중요:
      클라이언트에서 score를 직접 증가시키는 대신
      해당 round의 answer 기록과 score 변경을
      한 번의 update로 처리합니다.

      또한 이미 answer가 존재하면 다시 점수를
      지급하지 않습니다.
    */

    const playerRef =
      playersRef().child(playerId);

    const roundKey = String(questionIndex);
    await playerRef.transaction(player => {
      if(!player || player.answers?.[roundKey]?.submitted) return;
      const points = correct ? 1 : 0;
      player.score = Number(player.score || 0) + points;
      player.answers = player.answers || {};
      player.answers[roundKey] = {answer:answerIndex,correct,points,submitted:true,submittedAt:firebase.database.ServerValue.TIMESTAMP};
      player.lastSeenAt = firebase.database.ServerValue.TIMESTAMP;
      return player;
    }, undefined, false);

    await tryFinishRound();

  }catch(error){

    console.error(error);

    if(status){
      submitted=false;
      buttons.forEach(btn=>btn.disabled=false);
      status.textContent = "답변 저장에 실패했습니다. 다시 제출해주세요.";
    }
  }
}

/* =========================================================
   라운드 종료 판정
========================================================= */

let finishLock = false;

async function tryFinishRound(){

  if(finishLock) return;

  try{

    const stateSnap =
      await stateRef().once("value");

    const state =
      stateSnap.val() || {};

    if(
      state.phase !== PHASE.PLAYING
    ){
      return;
    }

    if(
      Number(state.round) !== Number(questionIndex)
    ){
      return;
    }

    const playersSnap =
      await playersRef().once("value");

    const players =
      getPlayersArray(playersSnap.val());

    const endedByTime =
      Date.now() >= Number(state.roundEndsAt || 0);

    const everyoneAnswered =
      allAnswered(players,questionIndex);

    if(
      !endedByTime &&
      !everyoneAnswered
    ){
      return;
    }

    if(role !== "host"){
      return;
    }

    finishLock = true;

    const currentSnap =
      await stateRef().once("value");

    const current =
      currentSnap.val() || {};

    if(
      current.phase !== PHASE.PLAYING ||
      Number(current.round) !== Number(questionIndex)
    ){
      finishLock = false;
      return;
    }

    const resultEnd =
      Date.now() + 2200;

    await stateRef().update({

      phase:PHASE.RESULT,

      resultEndsAt:resultEnd,

      updatedAt:firebase.database.ServerValue.TIMESTAMP

    });

    finishLock = false;

  }catch(error){

    finishLock = false;
    console.error(error);
  }
}

/* =========================================================
   RESULT
========================================================= */

function renderResult(){

  document.getElementById("app").innerHTML =
    navbar(`코드 <b>${pin}</b>`) +
    `
    <main>
      <div class="stage wide">

        <div class="result-card">

          <div class="status-pill">
            ● ROUND RESULT
          </div>

          <div class="big">⚔️</div>

          <h1 class="title">
            ROUND ${questionIndex + 1} 결과
          </h1>

          <div
            class="result-score"
            id="roundScore"
          >
            계산 중...
          </div>

          <div
            class="winner"
            id="roundWinner"
          ></div>

        </div>

        <div id="resultPlayers"></div>

        <div class="note" style="text-align:center">
          ${
            role === "host"
            ? "잠시 후 다음 문제로 이동합니다."
            : "진행자가 다음 라운드를 동기화하고 있습니다."
          }
        </div>

      </div>
    </main>
    `;

  updateResult();

  const state = stateData || {};

  const end =
    Number(state.resultEndsAt || 0);

  if(role === "host" && end){

    clearTimer();

    timer = setInterval(async () => {

      if(Date.now() >= end){

        clearTimer();

        const next =
          questionIndex + 1;

        if(next >= questions.length){

          await stateRef().set({

            phase:PHASE.FINISHED,

            round:questionIndex,

            finishedAt:firebase.database.ServerValue.TIMESTAMP,

            updatedAt:firebase.database.ServerValue.TIMESTAMP

          });

        }else{

          const now = Date.now();

          await stateRef().set({

            phase:PHASE.COUNTDOWN,

            round:next,

            countdownEndsAt:now + 3000,

            roundStartedAt:0,

            roundEndsAt:0,

            resultEndsAt:0,

            updatedAt:firebase.database.ServerValue.TIMESTAMP

          });

        }

      }

    },100);
  }
}

async function updateResult(){

  try{

    const snap =
      await playersRef().once("value");

    const players =
      getPlayersArray(snap.val());

    const container =
      document.getElementById("resultPlayers");

    if(!container) return;

    if(isTeam()){

      const a =
        teamScore(players,"A");

      const b =
        teamScore(players,"B");

      document.getElementById("roundScore").textContent =
        `${a} : ${b}`;

      document.getElementById("roundWinner").textContent =
        a === b
        ? "🤝 동점"
        : a > b
          ? "🔥 팀 A가 앞서고 있습니다!"
          : "💧 팀 B가 앞서고 있습니다!";

      container.innerHTML =
        renderTeamGrid(players);

      return;
    }

    const sorted =
      [...players].sort(
        (a,b) =>
          Number(b.score || 0) -
          Number(a.score || 0)
      );

    const me =
      players.find(p => p.id === playerId);

    const opponent =
      players.find(p => p.id !== playerId);

    const myScore =
      Number(me?.score || 0);

    const opponentScore =
      Number(opponent?.score || 0);

    document.getElementById("roundScore").textContent =
      `${myScore} : ${opponentScore}`;

    document.getElementById("roundWinner").textContent =
      myScore === opponentScore
      ? "🤝 현재 동점!"
      : myScore > opponentScore
        ? "🏆 현재 앞서고 있습니다!"
        : "💥 상대가 앞서고 있습니다!";

    container.innerHTML =
      sorted.map(p => `
        <div class="lead ${p.id === playerId ? "me" : ""}">
          <span class="name">
            ${p.role === "host" ? "👑 " : ""}
            ${esc(p.name)}
          </span>
          <span class="pts">
            ${Number(p.score || 0)}점
          </span>
        </div>
      `).join("");

  }catch(error){

    console.error(error);
  }
}

/* =========================================================
   FINISHED
========================================================= */

function renderFinished(){

  document.getElementById("app").innerHTML =
    navbar(`코드 <b>${pin}</b>`) +
    `
    <main>
      <div class="stage wide">

        <div class="result-card">

          <div class="big">🏆</div>

          <div class="status-pill">
            ● FINISHED
          </div>

          <h1 class="title">
            Battle 종료!
          </h1>

          <div
            class="result-score"
            id="finalScore"
          >
            결과 계산 중...
          </div>

          <div
            class="winner"
            id="finalWinner"
          ></div>

        </div>

        <div id="finalPlayers"></div>

        <div class="actions">

          <button class="btn" id="newBattle">
            🔄 새 Battle 만들기
          </button>

          <button class="btn ghost" id="homeBtn">
            🏠 FormWheel로 돌아가기
          </button>

        </div>

      </div>
    </main>
    `;

  updateFinal();

  document.getElementById("newBattle").onclick =
    () => {

      clearSession();

      pin = "";
      playerId = "";
      playerName = "";
      questionIndex = 0;
      role = "host";

      setScreen("setup");
    };

  document.getElementById("homeBtn").onclick =
    openHome;
}

async function updateFinal(){

  try{

    const snap =
      await playersRef().once("value");

    const players =
      getPlayersArray(snap.val());

    if(isTeam()){

      const a =
        teamScore(players,"A");

      const b =
        teamScore(players,"B");

      document.getElementById("finalScore")
        .textContent = `${a} : ${b}`;

      document.getElementById("finalWinner")
        .textContent =
          a === b
          ? "🤝 무승부!"
          : a > b
            ? "🔥 팀 A 승리!"
            : "💧 팀 B 승리!";

      document.getElementById("finalPlayers")
        .innerHTML =
          renderTeamGrid(players);

      return;
    }

    const sorted =
      [...players].sort(
        (a,b) =>
          Number(b.score || 0) -
          Number(a.score || 0)
      );

    const me =
      players.find(p => p.id === playerId);

    const opponent =
      players.find(p => p.id !== playerId);

    const myScore =
      Number(me?.score || 0);

    const opponentScore =
      Number(opponent?.score || 0);

    document.getElementById("finalScore")
      .textContent =
        `${myScore} : ${opponentScore}`;

    document.getElementById("finalWinner")
      .textContent =
        myScore === opponentScore
        ? "🤝 무승부!"
        : myScore > opponentScore
          ? `🏆 ${me?.name || playerName} 승리!`
          : `🏆 ${opponent?.name || "상대"} 승리!`;

    document.getElementById("finalPlayers")
      .innerHTML =
        sorted.map((p,i) => `
          <div class="lead ${p.id === playerId ? "me" : ""}">
            <span class="name">
              ${i === 0 ? "🏆 " : ""}
              ${p.role === "host" ? "👑 " : ""}
              ${esc(p.name)}
            </span>
            <span class="pts">
              ${Number(p.score || 0)}점
            </span>
          </div>
        `).join("");

  }catch(error){

    console.error(error);
  }
}

/* =========================================================
   방 나가기
========================================================= */

async function leaveRoom(deleteRoom = false){

  clearTimer();

  try{

    if(pin && playerId){

      if(role === "host" && deleteRoom){

        await battleRef().remove();

      }else{

        await playersRef()
          .child(playerId)
          .update({
            connected:false,
            left:true,
            leftAt:firebase.database.ServerValue.TIMESTAMP
          });

      }
    }

  }catch(error){

    console.error(error);

  }finally{

    clearSession();

    pin = "";
    playerId = "";
    playerName = "";
    questionIndex = 0;

    setScreen("home");
  }
}

/* =========================================================
   새로고침 복구
========================================================= */

async function restoreSession(){

  const session =
    loadSession();

  if(!session){
    render();
    return;
  }

  try{

    pin = session.pin;
    playerId = session.playerId;
    playerName = session.playerName;
    role = session.role;
    mode = session.mode || "1v1";
    teamSize = Number(session.teamSize || 2);
    myTeam = session.myTeam || "A";
    timeLimit = Number(session.timeLimit || 10);
    questionIndex = Number(session.questionIndex || 0);
    selectedQuizId = session.selectedQuizId || "";

    const snap =
      await battleRef().once("value");

    if(!snap.exists()){

      clearSession();

      pin = "";
      playerId = "";

      render();
      return;
    }

    const room =
      snap.val();

    const me =
      room.players?.[playerId];

    if(!me){

      clearSession();

      pin = "";
      playerId = "";

      render();
      return;
    }

    if(
      Array.isArray(room.meta?.questions) &&
      room.meta.questions.length
    ){
      questions =
        room.meta.questions;
    }

    mode =
      room.meta?.mode || mode;

    timeLimit =
      Number(room.meta?.timeLimit || timeLimit);

    teamSize =
      Number(room.meta?.teamSize || teamSize);

    myTeam =
      me.team || myTeam;

    stateData =
      room.state || {};

    /*
      새로고침으로 돌아온 플레이어는
      온라인 상태를 다시 활성화합니다.
    */
    await playersRef()
      .child(playerId)
      .update({
        connected:true,
        lastSeenAt:firebase.database.ServerValue.TIMESTAMP
      });

    const phase =
      stateData.phase || PHASE.WAITING;

    if(phase === PHASE.WAITING){

      screen =
        role === "host"
        ? "hostLobby"
        : "playerLobby";

    }else if(phase === PHASE.COUNTDOWN){

      screen = "countdown";

    }else if(phase === PHASE.PLAYING){

      screen = "playing";

    }else if(phase === PHASE.RESULT){

      screen = "result";

    }else if(phase === PHASE.FINISHED){

      screen = "finished";

    }else{

      screen = "home";
    }

    render();

    subscribeRoom();

  }catch(error){

    console.error(error);

    clearSession();

    pin = "";
    playerId = "";

    render();
  }
}

/* =========================================================
   브라우저 이탈 / 새로고침 처리
========================================================= */

function setupPresence(){

  window.addEventListener("beforeunload", () => {

    if(!pin || !playerId) return;

    /*
      beforeunload에서는 await를 사용할 수 없기 때문에
      onDisconnect를 기본 퇴장 장치로 사용합니다.
    */
  });

  window.addEventListener("pagehide", () => {

    if(!pin || !playerId) return;

    try{

      playersRef()
        .child(playerId)
        .onDisconnect()
        .update({
          connected:false,
          lastSeenAt:firebase.database.ServerValue.TIMESTAMP
        });

    }catch(_){}
  });
}

/* =========================================================
   방 연결 유지
========================================================= */

async function registerPresence(){

  if(!pin || !playerId) return;

  try{

    const ref =
      playersRef().child(playerId);

    await ref.onDisconnect().update({
      connected:false,
      lastSeenAt:firebase.database.ServerValue.TIMESTAMP
    });

    await ref.update({
      connected:true,
      lastSeenAt:firebase.database.ServerValue.TIMESTAMP
    });

  }catch(error){

    console.error("presence:",error);
  }
}

/* =========================================================
   주기적 presence 갱신
========================================================= */

setInterval(async () => {

  if(!pin || !playerId) return;

  try{

    await playersRef()
      .child(playerId)
      .update({
        connected:true,
        lastSeenAt:firebase.database.ServerValue.TIMESTAMP
      });

  }catch(_){}

},15000);

/* =========================================================
   방 상태 감시 보강
========================================================= */

const originalSubscribeRoom = subscribeRoom;

subscribeRoom = function(){

  originalSubscribeRoom();

  registerPresence();
};

/* =========================================================
   초기화
========================================================= */

setupPresence();

restoreSession();

})();
