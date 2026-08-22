import { Award, BookOpen, Bot, Check, Eye, Loader2, Menu, RefreshCcw, Search, Send, Sparkles, Target, X } from "lucide-react";
import { type DragEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type DiscardEvaluation,
  type DrawSession,
  type Exercise,
  type HintLevel,
  type ListeningExercise,
  type Suit,
  type Tile,
  type TileInstance,
  allTileKinds,
  createDrawSession,
  createExercise,
  createListeningExercise,
  discardFromDrawSession,
  drawFromWall,
  getBestEvaluations,
  getEvaluationForTile,
  tileLabel,
} from "./rules/fuzhou";

type AnswerState = {
  tileId: string;
  correct: boolean;
  evaluation: DiscardEvaluation;
};

type ListeningAnswer = {
  selectedIds: string[];
  correct: boolean;
};

type PracticeMode = "discard" | "listening" | "draw";

type RewardState = {
  id: string;
  streak: number;
  title: string;
  message: string;
};

type Stats = {
  total: number;
  correct: number;
  streak: number;
  bestStreak: number;
  today: number;
  dateKey: string;
};

type HandRow = {
  suit: Suit;
  tileIds: string[];
};

type CoachMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  usage?: TokenUsage;
  model?: string;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const statsKey = "fuzhou-mahjong-trainer-stats";
const modeDockTopKey = "fuzhou-mahjong-mode-dock-top";
const suitOrder: Suit[] = ["wan", "tong", "tiao"];
const suitNames: Record<Suit, string> = {
  wan: "万",
  tong: "筒",
  tiao: "条",
};
const chineseRanks = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadStats(): Stats {
  const fallback: Stats = {
    total: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    today: 0,
    dateKey: getDateKey(),
  };

  try {
    const raw = localStorage.getItem(statsKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Stats;
    if (parsed.dateKey !== fallback.dateKey) {
      return { ...parsed, today: 0, dateKey: fallback.dateKey };
    }
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function getDefaultDockTop(): number {
  if (typeof window === "undefined") return 128;
  if (window.innerWidth <= 560) return 72;
  if (window.innerWidth <= 920) return 84;
  return 128;
}

function clampDockTop(top: number): number {
  if (typeof window === "undefined") return top;
  return Math.min(Math.max(16, top), Math.max(16, window.innerHeight - 132));
}

function loadModeDockTop(): number {
  try {
    const raw = localStorage.getItem(modeDockTopKey);
    if (raw !== null) {
      const saved = Number(raw);
      if (Number.isFinite(saved)) return clampDockTop(saved);
    }
  } catch {
    return getDefaultDockTop();
  }

  return getDefaultDockTop();
}

function buildReward(streak: number): RewardState | null {
  if (streak === 3) {
    return {
      id: crypto.randomUUID(),
      streak,
      title: "三连对",
      message: "手感开始热起来了，继续保持这个判断节奏。",
    };
  }

  if (streak === 5 || (streak > 5 && streak % 5 === 0)) {
    return {
      id: crypto.randomUUID(),
      streak,
      title: `${streak} 连对`,
      message: "漂亮，这波牌效判断很稳。",
    };
  }

  return null;
}

export function App() {
  const [mode, setMode] = useState<PracticeMode>("discard");
  const [exercise, setExercise] = useState<Exercise>(() => createExercise());
  const [listeningExercise, setListeningExercise] = useState<ListeningExercise>(() => createListeningExercise());
  const [drawSession, setDrawSession] = useState<DrawSession>(() => createDrawSession());
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [drawAnswer, setDrawAnswer] = useState<AnswerState | null>(null);
  const [drawReviewEvaluations, setDrawReviewEvaluations] = useState<DiscardEvaluation[]>([]);
  const [drawWinClaimed, setDrawWinClaimed] = useState(false);
  const [pendingTileId, setPendingTileId] = useState<string | null>(null);
  const [listeningAnswer, setListeningAnswer] = useState<ListeningAnswer | null>(null);
  const [selectedWaitIds, setSelectedWaitIds] = useState<string[]>([]);
  const [hintLevel, setHintLevel] = useState<HintLevel>("teaching");
  const [stats, setStats] = useState<Stats>(() => loadStats());
  const [handRows, setHandRows] = useState<HandRow[]>(() => buildHandRows(exercise.hand));
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>(() => [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "这里是牌效解析。你可以问：为什么推荐打这张、我刚才打得怎么样、这手牌怎么拆。",
    },
  ]);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [reward, setReward] = useState<RewardState | null>(null);
  const previousStreakRef = useRef(stats.streak);

  useEffect(() => {
    localStorage.setItem(statsKey, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    const hand = mode === "discard" ? exercise.hand : mode === "listening" ? listeningExercise.hand : drawSession.hand;
    setHandRows(buildHandRows(hand));
  }, [drawSession, exercise, listeningExercise, mode]);

  useEffect(() => {
    if (!reward) return;
    const timer = window.setTimeout(() => setReward(null), 2800);
    return () => window.clearTimeout(timer);
  }, [reward]);

  useEffect(() => {
    if (!coachOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setCoachOpen(false);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [coachOpen]);

  useEffect(() => {
    if (stats.streak > previousStreakRef.current) {
      const nextReward = buildReward(stats.streak);
      if (nextReward) setReward(nextReward);
    }
    previousStreakRef.current = stats.streak;
  }, [stats.streak]);

  const bestEvaluations = useMemo(() => getBestEvaluations(exercise), [exercise]);
  const drawBestEvaluations = useMemo(
    () => {
      const evaluations = drawReviewEvaluations.length > 0 ? drawReviewEvaluations : drawSession.evaluations;
      const bestScore = evaluations.length > 0 ? Math.max(...evaluations.map((item) => item.score)) : 0;
      return evaluations.filter((item) => item.score >= bestScore - 0.01);
    },
    [drawReviewEvaluations, drawSession.evaluations],
  );
  const activeHand = mode === "discard" ? exercise.hand : mode === "listening" ? listeningExercise.hand : drawSession.hand;
  const activeGold = mode === "discard" ? exercise.gold : mode === "listening" ? listeningExercise.gold : drawSession.gold;
  const activeAnswer = mode === "draw" ? drawAnswer : answer;
  const tilesByInstance = useMemo(
    () => new Map(activeHand.map((tile) => [tile.instanceId, tile])),
    [activeHand],
  );

  function nextExercise() {
    if (mode === "discard") {
      setExercise(createExercise());
    } else if (mode === "listening") {
      setListeningExercise(createListeningExercise());
      setSelectedWaitIds([]);
      setListeningAnswer(null);
    } else {
      setDrawSession(createDrawSession());
      setDrawAnswer(null);
      setDrawReviewEvaluations([]);
      setDrawWinClaimed(false);
    }
    setAnswer(null);
    setPendingTileId(null);
    setCoachMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          mode === "discard"
            ? "新题已刷新。先点选要打的牌，再确认提交。"
            : mode === "listening"
              ? "听牌题已刷新。请选择你认为能胡的进张，再确认答案。"
              : "新的摸打局已开始。摸牌后先判断能不能胡，再选择要打出的牌。",
      },
    ]);
  }

  function chooseTile(tile: TileInstance) {
    if (mode === "draw") {
      chooseDrawTile(tile);
      return;
    }
    if (answer || mode !== "discard") return;
    if (pendingTileId !== tile.id) {
      setPendingTileId(tile.id);
      return;
    }
    confirmDiscard(tile.id);
  }

  function confirmDiscard(tileId = pendingTileId) {
    if (mode === "draw") {
      confirmDrawDiscard(tileId);
      return;
    }
    if (!tileId || answer || mode !== "discard") return;
    const tile = exercise.hand.find((item) => item.id === tileId);
    if (!tile) return;
    const evaluation = getEvaluationForTile(exercise, tile.id);
    if (!evaluation) return;

    const correct = exercise.bestDiscardIds.includes(tile.id);
    setAnswer({ tileId: tile.id, correct, evaluation });
    recordPracticeResult(correct);
  }

  function chooseDrawTile(tile: TileInstance) {
    if (drawAnswer || drawSession.won || !drawSession.drawnTile) return;
    if (pendingTileId !== tile.id) {
      setPendingTileId(tile.id);
      return;
    }
    confirmDrawDiscard(tile.id);
  }

  function confirmDrawDiscard(tileId = pendingTileId) {
    if (!tileId || drawAnswer || drawSession.won || !drawSession.drawnTile) return;
    const evaluation = drawSession.evaluations.find((item) => item.tile.id === tileId);
    if (!evaluation) return;

    const correct = drawSession.bestDiscardIds.includes(tileId);
    setDrawAnswer({ tileId, correct, evaluation });
    setDrawReviewEvaluations(drawSession.evaluations);
    setDrawSession((current) => discardFromDrawSession(current, tileId));
    setPendingTileId(null);
    recordPracticeResult(correct);
  }

  function continueDrawRound() {
    setDrawSession((current) => drawFromWall(current));
    setDrawAnswer(null);
    setDrawReviewEvaluations([]);
    setPendingTileId(null);
    setDrawWinClaimed(false);
  }

  function claimWin() {
    if (!drawSession.won || drawWinClaimed) return;
    setDrawWinClaimed(true);
    recordPracticeResult(true);
    setReward({
      id: crypto.randomUUID(),
      streak: stats.streak + 1,
      title: "胡牌达成",
      message: "这局摸打完整跑通了，节奏感很好。",
    });
  }

  function switchMode(nextMode: PracticeMode) {
    setMode(nextMode);
    setModeOpen(false);
    setAnswer(null);
    setDrawAnswer(null);
    setDrawReviewEvaluations([]);
    setDrawWinClaimed(false);
    setPendingTileId(null);
    setListeningAnswer(null);
    setSelectedWaitIds([]);
    setCoachMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          nextMode === "discard"
            ? "已切换到弃牌练习。先点选一张牌，再确认打出。"
            : nextMode === "listening"
              ? "已切换到听牌练习。选出所有能让这手牌胡牌的进张。"
              : "已切换到摸打到胡。每轮摸一张、打一张，先从自己的牌河开始复盘。",
      },
    ]);
  }

  function toggleWait(tileId: string) {
    if (listeningAnswer) return;
    setSelectedWaitIds((current) =>
      current.includes(tileId) ? current.filter((id) => id !== tileId) : [...current, tileId],
    );
  }

  function confirmListening() {
    if (listeningAnswer) return;
    const selected = [...selectedWaitIds].sort();
    const expected = listeningExercise.waitingTiles.map((tile) => tile.id).sort();
    const correct = selected.length === expected.length && selected.every((id, index) => id === expected[index]);
    setListeningAnswer({ selectedIds: selectedWaitIds, correct });
    recordPracticeResult(correct);
  }

  function recordPracticeResult(correct: boolean) {
    setStats((current) => {
      const streak = correct ? current.streak + 1 : 0;
      return {
        ...current,
        total: current.total + 1,
        correct: current.correct + (correct ? 1 : 0),
        streak,
        bestStreak: Math.max(current.bestStreak, streak),
        today: current.today + 1,
      };
    });
  }

  async function askCoach(question: string) {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || coachLoading) return;

    const userMessage: CoachMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmedQuestion,
    };

    setCoachMessages((current) => [...current, userMessage]);
    setCoachQuestion("");
    setCoachLoading(true);

    try {
      if (window.location.port === "5173") {
        throw new Error("local vite preview uses rule-based coach fallback");
      }

      const response = await fetch("/api/coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildCoachPayload(
            exercise,
            answer,
            trimmedQuestion,
            mode,
            listeningExercise,
            listeningAnswer,
            drawSession,
            drawAnswer,
            drawReviewEvaluations,
          ),
        ),
      });

      const data = (await response.json()) as { answer?: string; model?: string; usage?: TokenUsage | null };
      if (!response.ok) {
        setCoachMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: cleanCoachText(data.answer) || `牌效解析暂时不可用，错误码：${response.status}`,
            model: "DeepSeek 配置检查",
          },
        ]);
        return;
      }

      setCoachMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text:
            cleanCoachText(data.answer) ||
            buildLocalCoachReply(
              exercise,
              answer,
              trimmedQuestion,
              mode,
              listeningExercise,
              drawSession,
              drawAnswer,
              drawReviewEvaluations,
            ),
          usage: data.usage ?? undefined,
          model: data.model,
        },
      ]);
    } catch {
      setCoachMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: buildLocalCoachReply(
            exercise,
            answer,
            trimmedQuestion,
            mode,
            listeningExercise,
            drawSession,
            drawAnswer,
            drawReviewEvaluations,
          ),
          model: "本地规则引擎 · DeepSeek",
        },
      ]);
    } finally {
      setCoachLoading(false);
    }
  }

  return (
    <main className="app-shell theme-sakura">
      <RewardOverlay reward={reward} onClose={() => setReward(null)} />
      <ModeDock
        mode={mode}
        open={modeOpen}
        onToggle={() => setModeOpen((value) => !value)}
        onModeChange={switchMode}
      />
      <CoachLauncher
        open={coachOpen}
        loading={coachLoading}
        messageCount={coachMessages.length}
        onOpen={() => setCoachOpen(true)}
      />
      <CoachDrawer
        open={coachOpen}
        mode={mode}
        gold={activeGold}
        hand={activeHand}
        pendingTileId={pendingTileId}
        answer={activeAnswer}
        listeningExercise={listeningExercise}
        listeningAnswer={listeningAnswer}
        drawSession={drawSession}
        messages={coachMessages}
        question={coachQuestion}
        loading={coachLoading}
        onClose={() => setCoachOpen(false)}
        onQuestionChange={setCoachQuestion}
        onAsk={askCoach}
      />
      <section className="hero-panel">
        <div className="brand-block">
          <div className="brand-mark">福</div>
          <div>
            <h1>福州麻将练习器</h1>
            <p>从“摸进后打哪张”开始，练会金牌、搭子和有效进张。</p>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <img src="/sakura-coast-theme.jpg" alt="" />
        </div>
      </section>

      <section className="trainer-grid">
        <div className="table-zone">
          <div className="table-header">
            <div>
              <span className="label">本局金牌</span>
              <strong className="gold-name">
                {tileLabel(mode === "discard" ? exercise.gold : mode === "listening" ? listeningExercise.gold : drawSession.gold)}
              </strong>
            </div>
            <button className="icon-button" type="button" onClick={nextExercise} aria-label="换一题">
              <RefreshCcw size={18} />
            </button>
          </div>

          <div className="felt">
            <div className="rule-note">
              <BookOpen size={18} />
              {mode === "discard"
                ? "先点选要打的牌，再确认提交，避免误触。"
                : mode === "listening"
                  ? "请选择所有摸到即可胡的牌，练听口识别。"
                  : drawSession.won
                    ? "这手牌已经成胡形，可以点击胡牌完成本局。"
                    : "每轮摸一张、打一张；牌河先记录你自己的出牌。"}
            </div>
            {mode === "draw" ? <DrawStatus session={drawSession} /> : null}
            <TileRack
              rows={handRows}
              tilesByInstance={tilesByInstance}
              gold={mode === "discard" ? exercise.gold : mode === "listening" ? listeningExercise.gold : drawSession.gold}
              selectedId={mode === "draw" ? drawAnswer?.tileId : answer?.tileId}
              pendingId={pendingTileId}
              disabled={mode === "draw" ? Boolean(drawAnswer) || drawSession.won || !drawSession.drawnTile : Boolean(answer)}
              drawnInstanceId={mode === "draw" ? drawSession.drawnTile?.instanceId : undefined}
              onChoose={mode === "discard" || mode === "draw" ? chooseTile : undefined}
              onMoveGold={setHandRows}
            />
          </div>

          {mode === "discard" ? (
            <div className="action-strip">
              <HintControls hintLevel={hintLevel} setHintLevel={setHintLevel} />
              <button
                className="confirm-action"
                type="button"
                onClick={() => confirmDiscard()}
                disabled={!pendingTileId || Boolean(answer)}
              >
                <Check size={18} />
                确认打出{pendingTileId ? tileLabel(exercise.hand.find((tile) => tile.id === pendingTileId)!) : ""}
              </button>
            </div>
          ) : mode === "listening" ? (
            <ListeningPanel
              exercise={listeningExercise}
              selectedWaitIds={selectedWaitIds}
              answer={listeningAnswer}
              onToggleWait={toggleWait}
              onConfirm={confirmListening}
              onNext={nextExercise}
            />
          ) : (
            <DrawPlayPanel
              session={drawSession}
              answer={drawAnswer}
              pendingTileId={pendingTileId}
              hintLevel={hintLevel}
              setHintLevel={setHintLevel}
              onConfirm={() => confirmDiscard()}
              onContinue={continueDrawRound}
              onClaimWin={claimWin}
              onNewGame={nextExercise}
              winClaimed={drawWinClaimed}
            />
          )}
        </div>

        <aside className="side-panel">
          <StatsPanel stats={stats} />
          {mode === "discard" ? (
            <FeedbackPanel
              answer={answer}
              pendingTileId={pendingTileId}
              exercise={exercise}
              bestEvaluations={bestEvaluations}
              hintLevel={hintLevel}
              onNext={nextExercise}
            />
          ) : mode === "listening" ? (
            <ListeningFeedbackPanel exercise={listeningExercise} answer={listeningAnswer} onNext={nextExercise} />
          ) : (
            <DrawFeedbackPanel
              session={drawSession}
              answer={drawAnswer}
              pendingTileId={pendingTileId}
              evaluations={drawReviewEvaluations.length > 0 ? drawReviewEvaluations : drawSession.evaluations}
              bestEvaluations={drawBestEvaluations}
              hintLevel={hintLevel}
            />
          )}
        </aside>
      </section>
    </main>
  );
}

function RewardOverlay({ reward, onClose }: { reward: RewardState | null; onClose: () => void }) {
  if (!reward) return null;

  return (
    <button key={reward.id} className="reward-pop" type="button" onClick={onClose} aria-label="关闭连胜奖励">
      <span className="reward-rays" aria-hidden="true" />
      <span className="reward-medal">
        <Award size={30} />
      </span>
      <span className="reward-copy">
        <strong>{reward.title}</strong>
        <span>{reward.message}</span>
      </span>
      <span className="reward-streak">x{reward.streak}</span>
      <span className="reward-spark spark-one" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <span className="reward-spark spark-two" aria-hidden="true">
        <Sparkles size={14} />
      </span>
    </button>
  );
}

function ModeDock({
  mode,
  open,
  onToggle,
  onModeChange,
}: {
  mode: PracticeMode;
  open: boolean;
  onToggle: () => void;
  onModeChange: (mode: PracticeMode) => void;
}) {
  const [dockTop, setDockTop] = useState(loadModeDockTop);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startTop: number;
    timer: number | null;
    dragging: boolean;
    moved: boolean;
  } | null>(null);

  function clearLongPressTimer() {
    if (dragRef.current?.timer) {
      window.clearTimeout(dragRef.current.timer);
      dragRef.current.timer = null;
    }
  }

  function startDockGesture(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a nice-to-have; the dock still supports click toggling without it.
    }
    const gesture = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: dockTop,
      timer: null as number | null,
      dragging: false,
      moved: false,
    };
    gesture.timer = window.setTimeout(() => {
      gesture.dragging = true;
      setDragging(true);
    }, 260);
    dragRef.current = gesture;
  }

  function moveDockGesture(event: PointerEvent<HTMLButtonElement>) {
    const gesture = dragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const distance = event.clientY - gesture.startY;
    if (Math.abs(distance) > 4) gesture.moved = true;
    if (!gesture.dragging) return;

    event.preventDefault();
    setDockTop(clampDockTop(gesture.startTop + distance));
  }

  function endDockGesture(event: PointerEvent<HTMLButtonElement>) {
    const gesture = dragRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    clearLongPressTimer();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be released on some mobile browsers.
    }
    dragRef.current = null;
    setDragging(false);

    if (gesture.dragging) {
      try {
        localStorage.setItem(modeDockTopKey, String(clampDockTop(gesture.startTop + event.clientY - gesture.startY)));
      } catch {
        // Local storage may be unavailable in private modes; the drag still works for this session.
      }
      return;
    }

    onToggle();
  }

  function cancelDockGesture(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      clearLongPressTimer();
      dragRef.current = null;
      setDragging(false);
    }
  }

  return (
    <nav className={`mode-dock ${open ? "open" : ""} ${dragging ? "dragging" : ""}`} style={{ top: dockTop }} aria-label="练习模式">
      <button
        className="mode-tab"
        type="button"
        onPointerDown={startDockGesture}
        onPointerMove={moveDockGesture}
        onPointerUp={endDockGesture}
        onPointerCancel={cancelDockGesture}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        aria-label="切换练习模式，长按可移动位置"
        title="点击展开或收起，长按可上下移动"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
        <span>模式</span>
      </button>
      <div className="mode-drawer">
        <button
          className={`mode-button ${mode === "discard" ? "active" : ""}`}
          type="button"
          onClick={() => onModeChange("discard")}
        >
          <Target size={18} />
          弃牌练习
        </button>
        <button
          className={`mode-button ${mode === "listening" ? "active" : ""}`}
          type="button"
          onClick={() => onModeChange("listening")}
        >
          <Eye size={18} />
          听牌练习
        </button>
        <button
          className={`mode-button ${mode === "draw" ? "active" : ""}`}
          type="button"
          onClick={() => onModeChange("draw")}
        >
          <Sparkles size={18} />
          摸打到胡
        </button>
      </div>
    </nav>
  );
}

function buildCoachPayload(
  exercise: Exercise,
  answer: AnswerState | null,
  question: string,
  mode: PracticeMode,
  listeningExercise: ListeningExercise,
  listeningAnswer: ListeningAnswer | null,
  drawSession: DrawSession,
  drawAnswer: AnswerState | null,
  drawReviewEvaluations: DiscardEvaluation[],
) {
  const bestEvaluations = getBestEvaluations(exercise);
  const drawEvaluations = drawReviewEvaluations.length > 0 ? drawReviewEvaluations : drawSession.evaluations;
  const drawBestScore = drawEvaluations.length > 0 ? Math.max(...drawEvaluations.map((item) => item.score)) : 0;
  const drawBestEvaluations = drawEvaluations.filter((item) => item.score >= drawBestScore - 0.01);
  const activeGold = mode === "discard" ? exercise.gold : mode === "listening" ? listeningExercise.gold : drawSession.gold;
  const activeHand = mode === "discard" ? exercise.hand : mode === "listening" ? listeningExercise.hand : drawSession.hand;

  return {
    question,
    mode: mode === "discard" ? "弃牌练习" : mode === "listening" ? "听牌练习" : "摸打到胡",
    ruleset: "福州麻将新手教学版；不计分、不算花；金牌按万能牌理解。",
    gold: tileLabel(activeGold),
    hand: activeHand.map((tile) => tileLabel(tile)),
    selectedDiscard: (mode === "draw" ? drawAnswer : answer)
      ? {
          tile: tileLabel((mode === "draw" ? drawAnswer : answer)!.evaluation.tile),
          correct: (mode === "draw" ? drawAnswer : answer)!.correct,
          evaluation: summarizeEvaluation((mode === "draw" ? drawAnswer : answer)!.evaluation),
        }
      : null,
    recommendedDiscards: (mode === "draw" ? drawBestEvaluations : bestEvaluations).map(summarizeEvaluation),
    topCandidates: (mode === "draw" ? drawEvaluations : exercise.evaluations).slice(0, 6).map(summarizeEvaluation),
    listening:
      mode === "listening"
        ? {
            selected: listeningAnswer?.selectedIds.map((id) => tileLabel(allTileKinds.find((tile) => tile.id === id)!)) ?? [],
            correctWaits: listeningExercise.waitingTiles.map((tile) => tileLabel(tile)),
            waitingCopies: listeningExercise.waitingCopies,
        }
        : null,
    drawPlay:
      mode === "draw"
        ? {
            round: drawSession.round,
            maxRounds: drawSession.maxRounds,
            drawnTile: drawSession.drawnTile ? tileLabel(drawSession.drawnTile) : null,
            ownRiver: drawSession.river.map((tile) => tileLabel(tile)),
            won: drawSession.won,
            exhausted: drawSession.exhausted,
            currentWaits: drawSession.waitingTiles.map((tile) => tileLabel(tile)),
          }
        : null,
    specialPatterns:
      mode === "discard" ? exercise.specialPatterns : mode === "listening" ? listeningExercise.specialPatterns : drawSession.specialPatterns,
  };
}

function summarizeEvaluation(evaluation: DiscardEvaluation) {
  return {
    tile: tileLabel(evaluation.tile),
    score: Math.round(evaluation.score),
    winningDrawKinds: evaluation.winningDraws.length,
    winningDrawCopies: evaluation.winningDrawCopies,
    winningDraws: evaluation.winningDraws.map((tile) => tileLabel(tile)),
    reasons: evaluation.reasons,
  };
}

function buildLocalCoachReply(
  exercise: Exercise,
  answer: AnswerState | null,
  question: string,
  mode: PracticeMode,
  listeningExercise: ListeningExercise,
  drawSession: DrawSession,
  drawAnswer: AnswerState | null,
  drawReviewEvaluations: DiscardEvaluation[],
): string {
  if (mode === "listening") {
    const waits = listeningExercise.waitingTiles.map((tile) => tileLabel(tile)).join("、");
    return [
      "目前本地预览没有连接 Cloudflare 后端，我先用规则引擎给你一个简版解释。",
      `这手牌现在听：${waits}，合计 ${listeningExercise.waitingCopies} 张剩余机会。`,
      `本局金牌是 ${tileLabel(listeningExercise.gold)}，金牌能补面子或雀头，所以听口判断要把它当万能牌一起看。`,
    ].join("\n\n");
  }

  if (mode === "draw") {
    const drawEvaluations = drawReviewEvaluations.length > 0 ? drawReviewEvaluations : drawSession.evaluations;
    const bestScore = drawEvaluations.length > 0 ? Math.max(...drawEvaluations.map((item) => item.score)) : 0;
    const best = drawEvaluations.filter((item) => item.score >= bestScore - 0.01)[0];
    const selected = drawAnswer?.evaluation;
    const target = selected ?? best;
    const apiHint = "目前本地预览没有连接 Cloudflare 后端，我先用规则引擎给你一个简版解释。";

    if (drawSession.won) {
      return [
        apiHint,
        "这手牌摸进后已经成胡形，第一优先是识别能胡，不要再只按弃牌练习去拆牌。",
        `本局金牌是 ${tileLabel(drawSession.gold)}，目前自己的牌河：${formatRiver(drawSession.river)}。`,
      ].join("\n\n");
    }

    if (!target) {
      return [
        apiHint,
        "这一巡刚打完，先看自己的牌河复盘刚才打出的牌，再点继续摸牌进入下一巡。",
        `目前自己的牌河：${formatRiver(drawSession.river)}。`,
      ].join("\n\n");
    }

    return [
      apiHint,
      `第 ${drawSession.round} 巡，摸到 ${drawSession.drawnTile ? tileLabel(drawSession.drawnTile) : "一张牌"}。推荐优先看 ${tileLabel(best.tile)}，打出后有 ${best.winningDraws.length} 种胡牌进张，共 ${best.winningDrawCopies} 张剩余机会。`,
      selected ? `你刚才打 ${tileLabel(selected.tile)}：${selected.reasons.join(" ")}` : `如果打 ${tileLabel(target.tile)}：${target.reasons.join(" ")}`,
      `自己的牌河：${formatRiver(drawSession.river)}。第一版先用它帮你复盘，后面再加三家出牌和防守。`,
    ].join("\n\n");
  }

  const best = getBestEvaluations(exercise)[0];
  const selected = answer?.evaluation;
  const target = selected ?? best;
  const prefix = question.includes("我") && selected ? `你刚才打 ${tileLabel(selected.tile)}。` : "";
  const apiHint = "目前本地预览没有连接 Cloudflare 后端，我先用规则引擎给你一个简版解释。";

  return [
    apiHint,
    `${prefix}这手牌推荐优先看 ${tileLabel(best.tile)}，打出后有 ${best.winningDraws.length} 种胡牌进张，共 ${best.winningDrawCopies} 张剩余机会。`,
    `如果打 ${tileLabel(target.tile)}：${target.reasons.join(" ")}`,
    exercise.gold.id === target.tile.id
      ? "注意：这张是金牌，金通常是全手牌效最高的牌，不建议随便打。"
      : `本局金牌是 ${tileLabel(exercise.gold)}，判断时要优先考虑它能补顺、补刻或补雀头。`,
  ].join("\n\n");
}

function cleanCoachText(text?: string): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatRiver(river: TileInstance[]): string {
  return river.length > 0 ? river.map((tile) => tileLabel(tile)).join("、") : "还没有弃牌";
}

function buildHandRows(hand: TileInstance[]): HandRow[] {
  return suitOrder.map((suit) => ({
    suit,
    tileIds: hand
      .filter((tile) => tile.suit === suit)
      .sort((a, b) => a.rank - b.rank || a.instanceId.localeCompare(b.instanceId))
      .map((tile) => tile.instanceId),
  }));
}

function moveTileToRow(rows: HandRow[], draggedId: string, targetSuit: Suit, beforeId?: string): HandRow[] {
  const withoutDragged = rows.map((row) => ({
    ...row,
    tileIds: row.tileIds.filter((id) => id !== draggedId),
  }));

  return withoutDragged.map((row) => {
    if (row.suit !== targetSuit) return row;
    const nextIds = [...row.tileIds];
    const targetIndex = beforeId ? nextIds.indexOf(beforeId) : -1;
    if (targetIndex >= 0) {
      nextIds.splice(targetIndex, 0, draggedId);
    } else {
      nextIds.push(draggedId);
    }
    return { ...row, tileIds: nextIds };
  });
}

function TileRack({
  rows,
  tilesByInstance,
  gold,
  selectedId,
  pendingId,
  disabled,
  drawnInstanceId,
  onChoose,
  onMoveGold,
}: {
  rows: HandRow[];
  tilesByInstance: Map<string, TileInstance>;
  gold: Tile;
  selectedId?: string;
  pendingId?: string | null;
  disabled: boolean;
  drawnInstanceId?: string;
  onChoose?: (tile: TileInstance) => void;
  onMoveGold: (rows: HandRow[] | ((rows: HandRow[]) => HandRow[])) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function allowGoldDrop(event: DragEvent) {
    if (draggingId) event.preventDefault();
  }

  function moveGold(targetSuit: Suit, beforeId?: string) {
    if (!draggingId) return;
    onMoveGold((current) => moveTileToRow(current, draggingId, targetSuit, beforeId));
    setDraggingId(null);
  }

  return (
    <div className="tile-rack" aria-label="你的手牌">
      {rows.map((row) => (
        <div
          className={`suit-row ${row.suit}`}
          key={row.suit}
          onDragOver={allowGoldDrop}
          onDrop={() => moveGold(row.suit)}
        >
          <div className="suit-row-label">{suitNames[row.suit]}</div>
          <div className="suit-row-tiles">
            {row.tileIds.map((tileId) => {
              const tile = tilesByInstance.get(tileId);
              if (!tile) return null;
              const isGold = tile.id === gold.id;

              return (
                <button
                  className={`mahjong-tile ${tile.suit} ${isGold ? "gold" : ""} ${
                    selectedId === tile.id ? "selected" : ""
                  } ${pendingId === tile.id ? "pending" : ""} ${
                    drawnInstanceId === tile.instanceId ? "drawn" : ""
                  } ${draggingId === tile.instanceId ? "dragging" : ""}`}
                  key={tile.instanceId}
                  type="button"
                  disabled={disabled || !onChoose}
                  draggable={isGold && !disabled}
                  onClick={() => onChoose?.(tile)}
                  onDragStart={(event) => {
                    if (!isGold) return;
                    setDraggingId(tile.instanceId);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tile.instanceId);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={allowGoldDrop}
                  onDrop={(event) => {
                    event.stopPropagation();
                    moveGold(row.suit, tile.instanceId);
                  }}
                  aria-label={`打出${tileLabel(tile)}`}
                  title={isGold ? "金牌可拖动调整位置" : undefined}
                >
                  <TileFace tile={tile} isGold={isGold} />
                  {isGold ? <span className="gold-chip">金</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function TileFace({ tile, isGold }: { tile: TileInstance; isGold: boolean }) {
  if (tile.suit === "wan") {
    return (
      <>
        <span className="tile-rank chinese">{chineseRanks[tile.rank]}</span>
        <span className="tile-suit">萬</span>
        {isGold ? <span className="tile-helper">{tile.rank}万</span> : null}
      </>
    );
  }

  if (tile.suit === "tong") {
    return (
      <>
        <span className={`dot-pattern count-${tile.rank}`} aria-hidden="true">
          {Array.from({ length: tile.rank }, (_, index) => (
            <span key={index} />
          ))}
        </span>
        <span className="tile-helper">{tile.rank}筒</span>
      </>
    );
  }

  return (
    <>
      <span className={`bamboo-pattern count-${tile.rank}`} aria-hidden="true">
        {Array.from({ length: tile.rank }, (_, index) => (
          <span key={index} />
        ))}
      </span>
      <span className="tile-helper">{tile.rank}条</span>
    </>
  );
}

function HintControls({
  hintLevel,
  setHintLevel,
}: {
  hintLevel: HintLevel;
  setHintLevel: (level: HintLevel) => void;
}) {
  const levels: Array<{ id: HintLevel; label: string }> = [
    { id: "off", label: "关闭" },
    { id: "light", label: "轻提示" },
    { id: "teaching", label: "教学" },
  ];

  return (
    <div className="hint-row">
      <span>提示等级</span>
      <div className="segmented">
        {levels.map((level) => (
          <button
            className={hintLevel === level.id ? "active" : ""}
            key={level.id}
            type="button"
            onClick={() => setHintLevel(level.id)}
          >
            {level.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsPanel({ stats }: { stats: Stats }) {
  const accuracy = stats.total === 0 ? 0 : Math.round((stats.correct / stats.total) * 100);

  return (
    <div className="stats-panel">
      <div className="panel-title">
        <Award size={18} />
        今日概览
      </div>
      <div className="stats-grid">
        <Metric label="正确" value={`${accuracy}%`} />
        <Metric label="连对" value={stats.streak} />
        <Metric label="最佳" value={stats.bestStreak} />
        <Metric label="今日" value={stats.today} />
      </div>
    </div>
  );
}

function DrawStatus({ session }: { session: DrawSession }) {
  return (
    <div className={`draw-status ${session.won ? "won" : ""}`}>
      <span>第 {session.round}/{session.maxRounds} 巡</span>
      <strong>{session.drawnTile ? `摸到 ${tileLabel(session.drawnTile)}` : "等待摸牌"}</strong>
      <span>牌墙 {session.wall.length} 张</span>
    </div>
  );
}

function DrawPlayPanel({
  session,
  answer,
  pendingTileId,
  hintLevel,
  setHintLevel,
  onConfirm,
  onContinue,
  onClaimWin,
  onNewGame,
  winClaimed,
}: {
  session: DrawSession;
  answer: AnswerState | null;
  pendingTileId: string | null;
  hintLevel: HintLevel;
  setHintLevel: (level: HintLevel) => void;
  onConfirm: () => void;
  onContinue: () => void;
  onClaimWin: () => void;
  onNewGame: () => void;
  winClaimed: boolean;
}) {
  const pendingTile = pendingTileId ? session.hand.find((tile) => tile.id === pendingTileId) : undefined;
  const canContinue = Boolean(answer) && !session.won && !session.exhausted;

  return (
    <div className="draw-play-panel">
      <div className="action-strip draw-actions">
        <HintControls hintLevel={hintLevel} setHintLevel={setHintLevel} />
        {session.won ? (
          <button className="confirm-action win-action" type="button" onClick={onClaimWin} disabled={winClaimed}>
            <Sparkles size={18} />
            {winClaimed ? "已完成胡牌" : "胡牌"}
          </button>
        ) : canContinue ? (
          <button className="confirm-action" type="button" onClick={onContinue}>
            <RefreshCcw size={18} />
            继续摸牌
          </button>
        ) : session.exhausted ? (
          <button className="confirm-action" type="button" onClick={onNewGame}>
            <RefreshCcw size={18} />
            开新局
          </button>
        ) : (
          <button
            className="confirm-action"
            type="button"
            onClick={onConfirm}
            disabled={!pendingTileId || Boolean(answer) || !session.drawnTile}
          >
            <Check size={18} />
            确认打出{pendingTile ? tileLabel(pendingTile) : ""}
          </button>
        )}
      </div>

      <div className="river-panel">
        <div className="panel-title">
          <BookOpen size={18} />
          自己的牌河
        </div>
        {session.river.length > 0 ? (
          <div className="river-tiles">
            {session.river.map((tile) => (
              <span className={`mini-tile river-tile ${tile.suit}`} key={tile.instanceId}>
                <TileFace tile={tile} isGold={tile.id === session.gold.id} />
                {tile.id === session.gold.id ? <span className="gold-chip">金</span> : null}
              </span>
            ))}
          </div>
        ) : (
          <p className="body-copy">还没有弃牌。第一巡先看摸到的牌能不能让手牌更靠近听牌。</p>
        )}
      </div>
    </div>
  );
}

function ListeningPanel({
  exercise,
  selectedWaitIds,
  answer,
  onToggleWait,
  onConfirm,
  onNext,
}: {
  exercise: ListeningExercise;
  selectedWaitIds: string[];
  answer: ListeningAnswer | null;
  onToggleWait: (tileId: string) => void;
  onConfirm: () => void;
  onNext: () => void;
}) {
  const waitingIds = new Set(exercise.waitingTiles.map((tile) => tile.id));

  return (
    <div className="listening-panel">
      <div className="panel-title">
        <Search size={18} />
        选择所有听牌
      </div>
      <p className="body-copy">点选你认为摸到即可胡的牌，可以多选；提交后会显示正确听口。</p>
      <div className="wait-grid" aria-label="听牌候选">
        {allTileKinds.map((tile) => {
          const selected = selectedWaitIds.includes(tile.id);
          const revealed = Boolean(answer);
          const correct = waitingIds.has(tile.id);
          return (
            <button
              className={`wait-tile ${tile.suit} ${selected ? "selected" : ""} ${revealed && correct ? "correct" : ""} ${
                revealed && selected && !correct ? "wrong" : ""
              }`}
              key={tile.id}
              type="button"
              onClick={() => onToggleWait(tile.id)}
              disabled={revealed}
              aria-pressed={selected}
            >
              <TileFace tile={{ ...tile, instanceId: tile.id }} isGold={tile.id === exercise.gold.id} />
              {tile.id === exercise.gold.id ? <span className="gold-chip">金</span> : null}
            </button>
          );
        })}
      </div>
      <div className="listen-actions">
        <button className="confirm-action" type="button" onClick={onConfirm} disabled={Boolean(answer)}>
          <Check size={18} />
          确认听牌
        </button>
        {answer ? (
          <button className="soft-action" type="button" onClick={onNext}>
            下一题
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CoachLauncher({
  open,
  loading,
  messageCount,
  onOpen,
}: {
  open: boolean;
  loading: boolean;
  messageCount: number;
  onOpen: () => void;
}) {
  return (
    <button
      className={`coach-launcher ${open ? "open" : ""}`}
      type="button"
      onClick={onOpen}
      aria-label="打开牌效解析"
      aria-expanded={open}
    >
      <span className={`pet-avatar ${loading ? "thinking" : ""}`} aria-hidden="true" />
      <span className="coach-launcher-copy">
        <strong>牌效解析</strong>
        <span>{loading ? "正在思考" : `${Math.max(0, messageCount - 1)} 条对话`}</span>
      </span>
      <Bot size={18} />
    </button>
  );
}

function CoachDrawer({
  open,
  mode,
  gold,
  hand,
  pendingTileId,
  answer,
  listeningExercise,
  listeningAnswer,
  drawSession,
  messages,
  question,
  loading,
  onClose,
  onQuestionChange,
  onAsk,
}: {
  open: boolean;
  mode: PracticeMode;
  gold: Tile;
  hand: TileInstance[];
  pendingTileId: string | null;
  answer: AnswerState | null;
  listeningExercise: ListeningExercise;
  listeningAnswer: ListeningAnswer | null;
  drawSession: DrawSession;
  messages: CoachMessage[];
  question: string;
  loading: boolean;
  onClose: () => void;
  onQuestionChange: (question: string) => void;
  onAsk: (question: string) => void;
}) {
  return (
    <div className={`coach-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <button className="coach-backdrop" type="button" onClick={onClose} aria-label="关闭牌效解析遮罩" tabIndex={open ? 0 : -1} />
      <section className="coach-drawer" role="dialog" aria-modal="true" aria-label="牌效解析">
        <div className="coach-drawer-head">
          <div className="coach-title-block">
            <span className={`pet-avatar large ${loading ? "thinking" : ""}`} aria-hidden="true" />
            <div>
              <span className="label">AI 助手</span>
              <strong>牌效解析</strong>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭牌效解析">
            <X size={18} />
          </button>
        </div>

        <CoachSnapshot
          mode={mode}
          gold={gold}
          hand={hand}
          pendingTileId={pendingTileId}
          answer={answer}
          listeningExercise={listeningExercise}
          listeningAnswer={listeningAnswer}
          drawSession={drawSession}
        />

        <CoachPanel
          messages={messages}
          question={question}
          loading={loading}
          answer={answer}
          mode={mode}
          onQuestionChange={onQuestionChange}
          onAsk={onAsk}
        />
      </section>
    </div>
  );
}

function CoachSnapshot({
  mode,
  gold,
  hand,
  pendingTileId,
  answer,
  listeningExercise,
  listeningAnswer,
  drawSession,
}: {
  mode: PracticeMode;
  gold: Tile;
  hand: TileInstance[];
  pendingTileId: string | null;
  answer: AnswerState | null;
  listeningExercise: ListeningExercise;
  listeningAnswer: ListeningAnswer | null;
  drawSession: DrawSession;
}) {
  const modeLabel = mode === "discard" ? "弃牌练习" : mode === "listening" ? "听牌练习" : "摸打到胡";
  const pendingTile = pendingTileId ? hand.find((tile) => tile.id === pendingTileId) : undefined;
  const selectedWaits = listeningAnswer?.selectedIds
    .map((id) => allTileKinds.find((tile) => tile.id === id))
    .filter((tile): tile is Tile => Boolean(tile));

  return (
    <div className="coach-snapshot">
      <div className="snapshot-meta">
        <span>{modeLabel}</span>
        <strong>金牌 {tileLabel(gold)}</strong>
        {mode === "draw" ? <span>第 {drawSession.round}/{drawSession.maxRounds} 巡</span> : null}
      </div>

      <div className="snapshot-section">
        <span className="section-kicker">当前牌面</span>
        <MiniInstanceTileList tiles={hand} gold={gold} />
      </div>

      <div className="snapshot-facts">
        {pendingTile ? <span>待打出：{tileLabel(pendingTile)}</span> : null}
        {answer ? <span>已选择：{tileLabel(answer.evaluation.tile)} · {answer.correct ? "正确" : "待复盘"}</span> : null}
        {mode === "listening" ? (
          <span>
            听口：{listeningExercise.waitingTiles.length} 种
            {selectedWaits && selectedWaits.length > 0 ? ` · 已选 ${selectedWaits.map((tile) => tileLabel(tile)).join("、")}` : ""}
          </span>
        ) : null}
        {mode === "draw" ? (
          <>
            <span>{drawSession.drawnTile ? `摸到：${tileLabel(drawSession.drawnTile)}` : "等待下一次摸牌"}</span>
            <span>牌河：{formatRiver(drawSession.river)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MiniInstanceTileList({ tiles, gold }: { tiles: TileInstance[]; gold: Tile }) {
  return (
    <div className="snapshot-tiles">
      {tiles.map((tile) => (
        <span className={`mini-tile snapshot-tile ${tile.suit} ${tile.id === gold.id ? "gold" : ""}`} key={tile.instanceId}>
          <TileFace tile={tile} isGold={tile.id === gold.id} />
          {tile.id === gold.id ? <span className="gold-chip">金</span> : null}
        </span>
      ))}
    </div>
  );
}

function CoachPanel({
  messages,
  question,
  loading,
  answer,
  mode,
  onQuestionChange,
  onAsk,
}: {
  messages: CoachMessage[];
  question: string;
  loading: boolean;
  answer: AnswerState | null;
  mode: PracticeMode;
  onQuestionChange: (question: string) => void;
  onAsk: (question: string) => void;
}) {
  const quickQuestions =
    mode === "listening"
      ? ["这手牌听什么？", "为什么这些牌能胡？", "我漏看了哪里？"]
      : mode === "draw"
        ? answer
          ? ["我这巡打得怎样？", "自己的牌河说明什么？", "下一巡先看哪里？"]
          : ["这巡先打哪张？", "我现在能胡吗？", "牌河要观察什么？"]
        : answer
          ? ["我这张打得怎么样？", "为什么推荐打那张？", "用新手话讲一遍"]
          : ["这手牌先看哪里？", "为什么这些牌牌效低？", "金牌现在怎么用？"];

  return (
    <div className="coach-panel">
      <div className="panel-title">
        <Bot size={18} />
        牌效解析
      </div>
      <div className="coach-messages" aria-live="polite">
        {messages.map((message) => (
          <div className={`coach-message ${message.role}`} key={message.id}>
            {message.text}
            {message.usage ? <TokenUsageLine usage={message.usage} model={message.model} /> : null}
          </div>
        ))}
        {loading ? (
          <div className="coach-message assistant loading">
            <Loader2 size={16} />
            正在分析这手牌
          </div>
        ) : null}
      </div>
      <div className="quick-questions">
        {quickQuestions.map((item) => (
          <button key={item} type="button" onClick={() => onAsk(item)} disabled={loading}>
            {item}
          </button>
        ))}
      </div>
      <form
        className="coach-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAsk(question);
        }}
      >
        <input
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={
            mode === "listening"
              ? "问：这手牌听哪些牌？"
              : mode === "draw"
                ? "问：这巡为什么打这张？"
                : "问：为什么这张牌效最低？"
          }
          disabled={loading}
        />
        <button type="submit" aria-label="发送问题" disabled={loading || !question.trim()}>
          <Send size={17} />
        </button>
      </form>
    </div>
  );
}

function TokenUsageLine({ usage, model }: { usage: TokenUsage; model?: string }) {
  return (
    <span className="token-usage">
      {model ? `${model} · ` : null}
      输入 {usage.inputTokens} / 输出 {usage.outputTokens} / 共 {usage.totalTokens} tokens
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildLightDiscardHints(evaluations: DiscardEvaluation[], gold: Tile): string[] {
  const best = evaluations[0];
  if (!best) return ["先找联系最弱的一张，再比较打出后是否更接近听牌。"];

  const hints = [
    best.tile.id === gold.id
      ? "这手牌比较特殊，先检查金牌是否已经过多或成形。"
      : "先从普通牌里找孤张、边张、嵌张，金牌一般先留住。",
  ];

  if (best.winningDraws.length > 0) {
    hints.push("有打法已经能形成直接听牌，重点比较有效进张的数量。");
  } else if (best.isolatedPenalty > 0) {
    hints.push("这手有孤张负担，优先清理和周围牌联系弱的牌。");
  } else {
    hints.push("这手还没直接听牌，先保留顺子、对子和两面搭子。");
  }

  if (best.copiesInHand >= 2) {
    hints.push("对子未必都要留，若它挡住整体速度，也可能成为可拆对象。");
  }

  return hints.slice(0, 3);
}

function LightHintBox({ hints }: { hints: string[] }) {
  return (
    <div className="recommend-strip light-hint-strip">
      <span>轻提示</span>
      <div>
        {hints.map((hint) => (
          <strong key={hint}>{hint}</strong>
        ))}
      </div>
    </div>
  );
}

function FeedbackPanel({
  answer,
  pendingTileId,
  exercise,
  bestEvaluations,
  hintLevel,
  onNext,
}: {
  answer: AnswerState | null;
  pendingTileId: string | null;
  exercise: Exercise;
  bestEvaluations: DiscardEvaluation[];
  hintLevel: HintLevel;
  onNext: () => void;
}) {
  if (!answer) {
    const lightHints = exercise.evaluations.slice(0, 3);
    const directionHints = buildLightDiscardHints(exercise.evaluations, exercise.gold);

    return (
      <div className="feedback-panel guide-panel">
        <div className="feedback-hero">
          <span className="feedback-icon">
            <Target size={22} />
          </span>
          <div>
            <strong>选择弃牌</strong>
            <span>找出打掉后进张更宽的牌</span>
          </div>
        </div>
        <p className="feedback-brief">先比较孤张、边张、嵌张，再看打出后听牌种类和剩余张数。</p>
        {pendingTileId ? (
          <div className="feedback-status pending-card">
            <Check size={17} />
            <span>
              已选中 <strong>{tileLabel(exercise.hand.find((tile) => tile.id === pendingTileId)!)}</strong>
            </span>
            <em>再次点击同张或点确认</em>
          </div>
        ) : null}
        {exercise.specialPatterns.length > 0 ? (
          <div className="special-list">
            {exercise.specialPatterns.map((pattern) => (
              <div key={pattern.name}>
                <strong>{pattern.name}</strong>
                <span>{pattern.description}</span>
              </div>
            ))}
          </div>
        ) : null}
        {hintLevel === "light" ? <LightHintBox hints={directionHints} /> : null}
        {hintLevel === "teaching" ? (
          <div className="recommend-strip">
            <span>教学提示</span>
            <div>
              {lightHints.map((item, index) => (
                <strong key={item.tile.id}>
                  {index + 1}. {tileLabel(item.tile)}
                </strong>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const recommended = bestEvaluations.map((item) => tileLabel(item.tile)).join("、");

  return (
    <div className={`feedback-panel answered review-panel ${answer.correct ? "correct" : "wrong"}`}>
      <div className="review-head">
        <span className="review-badge">
          {answer.correct ? <Check size={20} /> : <X size={20} />}
        </span>
        <div>
          <strong>{answer.correct ? "选择正确" : "这张不是最优"}</strong>
          <span>
            打 {tileLabel(answer.evaluation.tile)} · 听牌 {answer.evaluation.winningDraws.length} 种 · 共{" "}
            {answer.evaluation.winningDrawCopies} 张
          </span>
        </div>
      </div>

      {hintLevel === "teaching" ? (
        <div className="review-grid">
          <div className="review-section">
            <span className="section-kicker">有效进张</span>
            <MiniTileList tiles={answer.evaluation.winningDraws} emptyText="暂无直接听牌" />
          </div>
          <div className="review-section">
            <span className="section-kicker">推荐前三</span>
            <div className="top-candidates">
              {exercise.evaluations.slice(0, 3).map((item, index) => (
                <div className={exercise.bestDiscardIds.includes(item.tile.id) ? "top-card best" : "top-card"} key={item.tile.id}>
                  <strong>
                    {index + 1}. 打 {tileLabel(item.tile)}
                  </strong>
                  <span>
                    听牌 {item.winningDraws.length} 种 · {item.winningDrawCopies} 张
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {hintLevel === "light" ? (
        <div className="reason-list">
          <p>
            {answer.correct
              ? "方向对了：你选到的是这手牌里保留整体速度较好的弃牌。"
              : `这张不是最优。轻提示只给答案方向：推荐打 ${recommended}，先比较它和你选择的牌谁保留更多搭子。`}
          </p>
        </div>
      ) : null}
      {hintLevel === "teaching" ? (
        <div className="reason-list">
          {(answer.correct ? answer.evaluation.reasons : bestEvaluations[0].reasons).map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          {!answer.correct ? <p>推荐打：{recommended}</p> : null}
        </div>
      ) : null}
      <button className="primary-action" type="button" onClick={onNext}>
        下一题
      </button>
    </div>
  );
}

function DrawFeedbackPanel({
  session,
  answer,
  pendingTileId,
  evaluations,
  bestEvaluations,
  hintLevel,
}: {
  session: DrawSession;
  answer: AnswerState | null;
  pendingTileId: string | null;
  evaluations: DiscardEvaluation[];
  bestEvaluations: DiscardEvaluation[];
  hintLevel: HintLevel;
}) {
  const best = bestEvaluations[0];

  if (session.won) {
    return (
      <div className="feedback-panel answered review-panel correct">
        <div className="review-head">
          <span className="review-badge">
            <Sparkles size={20} />
          </span>
          <div>
            <strong>已经成胡形</strong>
            <span>这一巡先练识别胡牌，不要继续拆牌</span>
          </div>
        </div>
        <div className="reason-list">
          <p>摸进 {session.drawnTile ? tileLabel(session.drawnTile) : "这张牌"} 后，当前手牌已经满足胡牌结构。</p>
          <p>自己的牌河：{formatRiver(session.river)}。</p>
        </div>
      </div>
    );
  }

  if (!answer) {
    const directionHints = buildLightDiscardHints(evaluations, session.gold);

    return (
      <div className="feedback-panel guide-panel">
        <div className="feedback-hero">
          <span className="feedback-icon">
            <Sparkles size={22} />
          </span>
          <div>
            <strong>摸打到胡</strong>
            <span>摸一张，打一张，逐巡靠近听牌</span>
          </div>
        </div>
        <p className="feedback-brief">
          先看摸进牌是否让搭子变顺、对子变刻，再比较打出后还能保留多少有效进张。
        </p>
        {pendingTileId ? (
          <div className="feedback-status pending-card">
            <Check size={17} />
            <span>
              已选中 <strong>{tileLabel(session.hand.find((tile) => tile.id === pendingTileId)!)}</strong>
            </span>
            <em>再次点击同张或点确认</em>
          </div>
        ) : null}
        {best && hintLevel === "light" ? <LightHintBox hints={directionHints} /> : null}
        {best && hintLevel === "teaching" ? (
          <div className="recommend-strip">
            <span>本巡教学提示</span>
            <div>
              {evaluations.slice(0, 3).map((item, index) => (
                <strong key={item.tile.id}>
                  {index + 1}. {tileLabel(item.tile)}
                </strong>
              ))}
            </div>
          </div>
        ) : null}
        {hintLevel === "teaching" ? (
          <div className="review-section">
            <span className="section-kicker">当前 16 张底牌听口</span>
            <MiniTileList tiles={session.waitingTiles} emptyText="还没形成直接听口" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`feedback-panel answered review-panel ${answer.correct ? "correct" : "wrong"}`}>
      <div className="review-head">
        <span className="review-badge">
          {answer.correct ? <Check size={20} /> : <X size={20} />}
        </span>
        <div>
          <strong>{answer.correct ? "本巡选择合理" : "这巡还有更优选择"}</strong>
          <span>
            打 {tileLabel(answer.evaluation.tile)} · 听牌 {answer.evaluation.winningDraws.length} 种 · 共{" "}
            {answer.evaluation.winningDrawCopies} 张
          </span>
        </div>
      </div>

      {hintLevel === "teaching" ? (
        <div className="review-grid">
          <div className="review-section">
            <span className="section-kicker">打出后的有效进张</span>
            <MiniTileList tiles={answer.evaluation.winningDraws} emptyText="暂无直接听牌" />
          </div>
          <div className="review-section">
            <span className="section-kicker">本巡推荐</span>
            <div className="top-candidates">
              {evaluations.slice(0, 3).map((item, index) => (
                <div className={bestEvaluations.some((bestItem) => bestItem.tile.id === item.tile.id) ? "top-card best" : "top-card"} key={item.tile.id}>
                  <strong>
                    {index + 1}. 打 {tileLabel(item.tile)}
                  </strong>
                  <span>
                    听牌 {item.winningDraws.length} 种 · {item.winningDrawCopies} 张
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {hintLevel === "light" ? (
        <div className="reason-list">
          <p>
            {answer.correct
              ? "本巡方向对了：你选到的是较适合这手牌继续推进的弃牌。"
              : `这巡还有更优选择。轻提示只点方向：推荐打 ${bestEvaluations.map((item) => tileLabel(item.tile)).join("、")}，先比较它能保留多少有效进张。`}
          </p>
          <p>自己的牌河：{formatRiver(session.river)}。</p>
        </div>
      ) : null}
      {hintLevel === "teaching" ? (
        <div className="reason-list">
          {(answer.correct ? answer.evaluation.reasons : best?.reasons ?? answer.evaluation.reasons).map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          {!answer.correct && best ? <p>推荐打：{bestEvaluations.map((item) => tileLabel(item.tile)).join("、")}</p> : null}
          <p>自己的牌河：{formatRiver(session.river)}。</p>
        </div>
      ) : null}
    </div>
  );
}

function ListeningFeedbackPanel({
  exercise,
  answer,
  onNext,
}: {
  exercise: ListeningExercise;
  answer: ListeningAnswer | null;
  onNext: () => void;
}) {
  const waits = exercise.waitingTiles.map((tile) => tileLabel(tile));
  const selectedLabels = answer?.selectedIds.map((id) => tileLabel(allTileKinds.find((tile) => tile.id === id)!)) ?? [];
  const missed = waits.filter((label) => !selectedLabels.includes(label));
  const extra = selectedLabels.filter((label) => !waits.includes(label));

  if (!answer) {
    return (
      <div className="feedback-panel guide-panel">
        <div className="feedback-hero">
          <span className="feedback-icon">
            <Eye size={22} />
          </span>
          <div>
            <strong>听牌判断</strong>
            <span>选择所有摸到即可胡的牌</span>
          </div>
        </div>
        <p className="feedback-brief">先找缺口，再把金牌当万能牌补进面子或雀头里试一遍。</p>
        {exercise.specialPatterns.length > 0 ? (
          <div className="special-list">
            {exercise.specialPatterns.map((pattern) => (
              <div key={pattern.name}>
                <strong>{pattern.name}</strong>
                <span>{pattern.description}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`feedback-panel answered review-panel ${answer.correct ? "correct" : "wrong"}`}>
      <div className="review-head">
        <span className="review-badge">
          {answer.correct ? <Check size={20} /> : <X size={20} />}
        </span>
        <div>
          <strong>{answer.correct ? "听牌判断正确" : "听口还没找全"}</strong>
          <span>
            听牌 {waits.length} 种 · 共 {exercise.waitingCopies} 张
          </span>
        </div>
      </div>

      <div className="review-section">
        <span className="section-kicker">正确听牌</span>
        <MiniTileList tiles={exercise.waitingTiles} emptyText="暂无听口" />
      </div>

      <div className="reason-list">
        {missed.length > 0 ? <p>漏选：{missed.join("、")}</p> : null}
        {extra.length > 0 ? <p>多选：{extra.join("、")}</p> : null}
        {answer.correct ? <p>选择完整，下一题继续保持。</p> : null}
      </div>
      <button className="primary-action" type="button" onClick={onNext}>
        下一题
      </button>
    </div>
  );
}

function MiniTileList({ tiles, emptyText }: { tiles: Tile[]; emptyText: string }) {
  if (tiles.length === 0) {
    return <span className="empty-mini-tiles">{emptyText}</span>;
  }

  return (
    <div className="mini-tile-list">
      {tiles.map((tile) => (
        <span className={`mini-tile ${tile.suit}`} key={tile.id}>
          <TileFace tile={{ ...tile, instanceId: tile.id }} isGold={false} />
        </span>
      ))}
    </div>
  );
}

function EvaluationDetail({
  evaluation,
  hintLevel,
  title,
}: {
  evaluation: DiscardEvaluation;
  hintLevel: HintLevel;
  title?: string;
}) {
  if (hintLevel === "off") return null;
  const reasons = hintLevel === "light" ? evaluation.reasons.slice(0, 1) : evaluation.reasons;

  return (
    <div className="explain-block">
      <span>{title ?? `你选择打 ${tileLabel(evaluation.tile)}`}</span>
      <div className="score-line">
        <strong>{evaluation.winningDraws.length}</strong> 种胡牌进张
        <strong>{evaluation.winningDrawCopies}</strong> 张剩余机会
      </div>
      {reasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      {hintLevel === "teaching" && evaluation.winningDraws.length > 0 ? (
        <p>可胡：{evaluation.winningDraws.map((tile) => tileLabel(tile)).join("、")}</p>
      ) : null}
    </div>
  );
}
