import { Award, BookOpen, Bot, Check, Eye, Loader2, Menu, RefreshCcw, Search, Send, Sparkles, Target, X } from "lucide-react";
import { type DragEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type DiscardEvaluation,
  type Exercise,
  type HintLevel,
  type ListeningExercise,
  type Suit,
  type Tile,
  type TileInstance,
  allTileKinds,
  createExercise,
  createListeningExercise,
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

type PracticeMode = "discard" | "listening";

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

export function App() {
  const [mode, setMode] = useState<PracticeMode>("discard");
  const [exercise, setExercise] = useState<Exercise>(() => createExercise());
  const [listeningExercise, setListeningExercise] = useState<ListeningExercise>(() => createListeningExercise());
  const [answer, setAnswer] = useState<AnswerState | null>(null);
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
  const [modeOpen, setModeOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(statsKey, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    setHandRows(buildHandRows(mode === "discard" ? exercise.hand : listeningExercise.hand));
  }, [exercise, listeningExercise, mode]);

  const bestEvaluations = useMemo(() => getBestEvaluations(exercise), [exercise]);
  const activeHand = mode === "discard" ? exercise.hand : listeningExercise.hand;
  const tilesByInstance = useMemo(
    () => new Map(activeHand.map((tile) => [tile.instanceId, tile])),
    [activeHand],
  );

  function nextExercise() {
    if (mode === "discard") {
      setExercise(createExercise());
    } else {
      setListeningExercise(createListeningExercise());
      setSelectedWaitIds([]);
      setListeningAnswer(null);
    }
    setAnswer(null);
    setPendingTileId(null);
    setCoachMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: mode === "discard" ? "新题已刷新。先点选要打的牌，再确认提交。" : "听牌题已刷新。请选择你认为能胡的进张，再确认答案。",
      },
    ]);
  }

  function chooseTile(tile: TileInstance) {
    if (answer) return;
    if (pendingTileId !== tile.id) {
      setPendingTileId(tile.id);
      return;
    }
    confirmDiscard(tile.id);
  }

  function confirmDiscard(tileId = pendingTileId) {
    if (!tileId || answer) return;
    const tile = exercise.hand.find((item) => item.id === tileId);
    if (!tile) return;
    const evaluation = getEvaluationForTile(exercise, tile.id);
    if (!evaluation) return;

    const correct = exercise.bestDiscardIds.includes(tile.id);
    setAnswer({ tileId: tile.id, correct, evaluation });
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

  function switchMode(nextMode: PracticeMode) {
    setMode(nextMode);
    setModeOpen(false);
    setAnswer(null);
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
            : "已切换到听牌练习。选出所有能让这手牌胡牌的进张。",
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
          buildCoachPayload(exercise, answer, trimmedQuestion, mode, listeningExercise, listeningAnswer),
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
            buildLocalCoachReply(exercise, answer, trimmedQuestion, mode, listeningExercise),
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
          text: buildLocalCoachReply(exercise, answer, trimmedQuestion, mode, listeningExercise),
          model: "本地规则引擎 · DeepSeek",
        },
      ]);
    } finally {
      setCoachLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <ModeDock
        mode={mode}
        open={modeOpen}
        onToggle={() => setModeOpen((value) => !value)}
        onModeChange={switchMode}
      />
      <section className="hero-panel">
        <div className="brand-block">
          <div className="brand-mark">福</div>
          <div>
            <h1>福州麻将练习器</h1>
            <p>从“摸进后打哪张”开始，练会金牌、搭子和有效进张。</p>
          </div>
        </div>
      </section>

      <section className="trainer-grid">
        <div className="table-zone">
          <div className="table-header">
            <div>
              <span className="label">本局金牌</span>
              <strong className="gold-name">
                {tileLabel(mode === "discard" ? exercise.gold : listeningExercise.gold)}
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
                : "请选择所有摸到即可胡的牌，练听口识别。"}
            </div>
            <TileRack
              rows={handRows}
              tilesByInstance={tilesByInstance}
              gold={mode === "discard" ? exercise.gold : listeningExercise.gold}
              selectedId={answer?.tileId}
              pendingId={pendingTileId}
              disabled={Boolean(answer)}
              onChoose={mode === "discard" ? chooseTile : undefined}
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
          ) : (
            <ListeningPanel
              exercise={listeningExercise}
              selectedWaitIds={selectedWaitIds}
              answer={listeningAnswer}
              onToggleWait={toggleWait}
              onConfirm={confirmListening}
              onNext={nextExercise}
            />
          )}
        </div>

        <aside className="side-panel">
          <StatsPanel stats={stats} />
          <CoachPanel
            messages={coachMessages}
            question={coachQuestion}
            loading={coachLoading}
            answer={answer}
            mode={mode}
            onQuestionChange={setCoachQuestion}
            onAsk={askCoach}
          />
          {mode === "discard" ? (
            <FeedbackPanel
              answer={answer}
              pendingTileId={pendingTileId}
              exercise={exercise}
              bestEvaluations={bestEvaluations}
              hintLevel={hintLevel}
              onNext={nextExercise}
            />
          ) : (
            <ListeningFeedbackPanel exercise={listeningExercise} answer={listeningAnswer} onNext={nextExercise} />
          )}
        </aside>
      </section>
    </main>
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
        <button className="mode-button locked" type="button" disabled>
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
) {
  const bestEvaluations = getBestEvaluations(exercise);

  return {
    question,
    mode: mode === "discard" ? "弃牌练习" : "听牌练习",
    ruleset: "福州麻将新手教学版；不计分、不算花；金牌按万能牌理解。",
    gold: tileLabel(mode === "discard" ? exercise.gold : listeningExercise.gold),
    hand: (mode === "discard" ? exercise.hand : listeningExercise.hand).map((tile) => tileLabel(tile)),
    selectedDiscard: answer
      ? {
          tile: tileLabel(answer.evaluation.tile),
          correct: answer.correct,
          evaluation: summarizeEvaluation(answer.evaluation),
        }
      : null,
    recommendedDiscards: bestEvaluations.map(summarizeEvaluation),
    topCandidates: exercise.evaluations.slice(0, 6).map(summarizeEvaluation),
    listening:
      mode === "listening"
        ? {
            selected: listeningAnswer?.selectedIds.map((id) => tileLabel(allTileKinds.find((tile) => tile.id === id)!)) ?? [],
            correctWaits: listeningExercise.waitingTiles.map((tile) => tileLabel(tile)),
            waitingCopies: listeningExercise.waitingCopies,
          }
        : null,
    specialPatterns: mode === "discard" ? exercise.specialPatterns : listeningExercise.specialPatterns,
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
): string {
  if (mode === "listening") {
    const waits = listeningExercise.waitingTiles.map((tile) => tileLabel(tile)).join("、");
    return [
      "目前本地预览没有连接 Cloudflare 后端，我先用规则引擎给你一个简版解释。",
      `这手牌现在听：${waits}，合计 ${listeningExercise.waitingCopies} 张剩余机会。`,
      `本局金牌是 ${tileLabel(listeningExercise.gold)}，金牌能补面子或雀头，所以听口判断要把它当万能牌一起看。`,
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
  onChoose,
  onMoveGold,
}: {
  rows: HandRow[];
  tilesByInstance: Map<string, TileInstance>;
  gold: Tile;
  selectedId?: string;
  pendingId?: string | null;
  disabled: boolean;
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
                  } ${pendingId === tile.id ? "pending" : ""} ${draggingId === tile.instanceId ? "dragging" : ""}`}
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
          placeholder={mode === "listening" ? "问：这手牌听哪些牌？" : "问：为什么这张牌效最低？"}
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

    return (
      <div className="feedback-panel">
        <div className="panel-title">
          <Target size={18} />
          选择你要打掉的牌
        </div>
        <p className="body-copy">目标是找出打掉后牌形保留最好、有效进张最多的牌。</p>
        {pendingTileId ? (
          <div className="pending-card">
            已选中 <strong>{tileLabel(exercise.hand.find((tile) => tile.id === pendingTileId)!)}</strong>，再次点击同一张牌或点确认按钮提交。
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
        {hintLevel !== "off" ? (
          <div className="hint-card">
            <span>可优先观察</span>
            <strong>{lightHints.map((item) => tileLabel(item.tile)).join("、")}</strong>
          </div>
        ) : null}
      </div>
    );
  }

  const recommended = bestEvaluations.map((item) => tileLabel(item.tile)).join("、");

  return (
    <div className={`feedback-panel answered ${answer.correct ? "correct" : "wrong"}`}>
      <div className="result-line">
        <span>{answer.correct ? "判断正确" : "这张不是最优弃牌"}</span>
        <strong>{answer.correct ? "+1" : "再看牌效"}</strong>
      </div>
      <p className="body-copy">
        推荐打：<strong>{recommended}</strong>
      </p>
      <EvaluationDetail evaluation={answer.evaluation} hintLevel={hintLevel} />
      {!answer.correct ? (
        <EvaluationDetail evaluation={bestEvaluations[0]} hintLevel="teaching" title="推荐弃牌说明" />
      ) : null}
      <button className="primary-action" type="button" onClick={onNext}>
        下一题
      </button>
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
      <div className="feedback-panel">
        <div className="panel-title">
          <Eye size={18} />
          听牌判断
        </div>
        <p className="body-copy">这是一副 16 张手牌。请选择所有“摸到即可胡”的牌。</p>
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
    <div className={`feedback-panel answered ${answer.correct ? "correct" : "wrong"}`}>
      <div className="result-line">
        <span>{answer.correct ? "听牌判断正确" : "听口还没找全"}</span>
        <strong>{answer.correct ? "+1" : "复盘"}</strong>
      </div>
      <div className="explain-block">
        <span>正确听牌</span>
        <p>
          <strong>{waits.join("、")}</strong>，合计 {exercise.waitingCopies} 张剩余机会。
        </p>
        {missed.length > 0 ? <p>漏选：{missed.join("、")}</p> : null}
        {extra.length > 0 ? <p>多选：{extra.join("、")}</p> : null}
      </div>
      <button className="primary-action" type="button" onClick={onNext}>
        下一题
      </button>
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
