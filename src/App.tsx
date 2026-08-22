import { Award, BookOpen, Bot, Eye, Loader2, RefreshCcw, Send, Sparkles, Target } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import {
  type DiscardEvaluation,
  type Exercise,
  type HintLevel,
  type Suit,
  type Tile,
  type TileInstance,
  createExercise,
  getBestEvaluations,
  getEvaluationForTile,
  tileLabel,
} from "./rules/fuzhou";

type AnswerState = {
  tileId: string;
  correct: boolean;
  evaluation: DiscardEvaluation;
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

type CoachProvider = "openai" | "deepseek";

const statsKey = "fuzhou-mahjong-trainer-stats";
const providerStorageKey = "fuzhou-mahjong-coach-provider";
const suitOrder: Suit[] = ["wan", "tong", "tiao"];
const suitNames: Record<Suit, string> = {
  wan: "万",
  tong: "筒",
  tiao: "条",
};
const chineseRanks = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const coachProviders: Array<{ id: CoachProvider; label: string }> = [
  { id: "openai", label: "Codex / OpenAI" },
  { id: "deepseek", label: "DeepSeek" },
];

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

export function App() {
  const [exercise, setExercise] = useState<Exercise>(() => createExercise());
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [hintLevel, setHintLevel] = useState<HintLevel>("teaching");
  const [stats, setStats] = useState<Stats>(() => loadStats());
  const [handRows, setHandRows] = useState<HandRow[]>(() => buildHandRows(exercise.hand));
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>(() => [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "我是你的福州麻将 AI 教练。你可以问：为什么推荐打这张、我刚才打得怎么样、这手牌怎么拆。",
    },
  ]);
  const [coachQuestion, setCoachQuestion] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachProvider, setCoachProvider] = useState<CoachProvider>(() => loadCoachProvider());

  useEffect(() => {
    localStorage.setItem(statsKey, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    setHandRows(buildHandRows(exercise.hand));
  }, [exercise]);

  useEffect(() => {
    localStorage.setItem(providerStorageKey, coachProvider);
  }, [coachProvider]);

  const bestEvaluations = useMemo(() => getBestEvaluations(exercise), [exercise]);
  const tilesByInstance = useMemo(
    () => new Map(exercise.hand.map((tile) => [tile.instanceId, tile])),
    [exercise.hand],
  );

  function nextExercise() {
    setExercise(createExercise());
    setAnswer(null);
    setCoachMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "新题已刷新。可以先自己判断，再问我这手牌的牌效。",
      },
    ]);
  }

  function chooseTile(tile: TileInstance) {
    if (answer) return;
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
        body: JSON.stringify(buildCoachPayload(exercise, answer, trimmedQuestion, coachProvider)),
      });

      if (!response.ok) {
        throw new Error(`coach api ${response.status}`);
      }

      const data = (await response.json()) as { answer?: string; model?: string; usage?: TokenUsage | null };
      setCoachMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.answer?.trim() || buildLocalCoachReply(exercise, answer, trimmedQuestion),
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
          text: buildLocalCoachReply(exercise, answer, trimmedQuestion),
          model: `本地规则引擎 · ${getProviderLabel(coachProvider)}`,
        },
      ]);
    } finally {
      setCoachLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="brand-block">
          <div className="brand-mark">福</div>
          <div>
            <h1>福州麻将练习器</h1>
            <p>从“摸进后打哪张”开始，练会金牌、搭子和有效进张。</p>
          </div>
        </div>
        <div className="mode-strip" aria-label="练习模式">
          <button className="mode-button active" type="button">
            <Target size={18} />
            弃牌练习
          </button>
          <button className="mode-button locked" type="button" disabled>
            <Eye size={18} />
            听牌练习
          </button>
          <button className="mode-button locked" type="button" disabled>
            <Sparkles size={18} />
            摸打到胡
          </button>
        </div>
      </section>

      <section className="trainer-grid">
        <div className="table-zone">
          <div className="table-header">
            <div>
              <span className="label">本局金牌</span>
              <strong className="gold-name">{tileLabel(exercise.gold)}</strong>
            </div>
            <button className="icon-button" type="button" onClick={nextExercise} aria-label="换一题">
              <RefreshCcw size={18} />
            </button>
          </div>

          <div className="felt">
            <div className="rule-note">
              <BookOpen size={18} />
              不计分、不算花，先练福州麻将新手最关键的弃牌牌效。
            </div>
            <TileRack
              rows={handRows}
              tilesByInstance={tilesByInstance}
              gold={exercise.gold}
              selectedId={answer?.tileId}
              disabled={Boolean(answer)}
              onChoose={chooseTile}
              onMoveGold={setHandRows}
            />
          </div>

          <HintControls hintLevel={hintLevel} setHintLevel={setHintLevel} />
        </div>

        <aside className="side-panel">
          <StatsPanel stats={stats} />
          <CoachPanel
            messages={coachMessages}
            question={coachQuestion}
            loading={coachLoading}
            provider={coachProvider}
            answer={answer}
            onQuestionChange={setCoachQuestion}
            onProviderChange={setCoachProvider}
            onAsk={askCoach}
          />
          <FeedbackPanel
            answer={answer}
            exercise={exercise}
            bestEvaluations={bestEvaluations}
            hintLevel={hintLevel}
            onNext={nextExercise}
          />
        </aside>
      </section>
    </main>
  );
}

function loadCoachProvider(): CoachProvider {
  const saved = localStorage.getItem(providerStorageKey);
  return saved === "deepseek" ? "deepseek" : "openai";
}

function getProviderLabel(provider: CoachProvider): string {
  return coachProviders.find((item) => item.id === provider)?.label ?? "Codex / OpenAI";
}

function buildCoachPayload(
  exercise: Exercise,
  answer: AnswerState | null,
  question: string,
  provider: CoachProvider,
) {
  const bestEvaluations = getBestEvaluations(exercise);

  return {
    provider,
    question,
    ruleset: "福州麻将新手教学版；不计分、不算花；金牌按万能牌理解。",
    gold: tileLabel(exercise.gold),
    hand: exercise.hand.map((tile) => tileLabel(tile)),
    selectedDiscard: answer
      ? {
          tile: tileLabel(answer.evaluation.tile),
          correct: answer.correct,
          evaluation: summarizeEvaluation(answer.evaluation),
        }
      : null,
    recommendedDiscards: bestEvaluations.map(summarizeEvaluation),
    topCandidates: exercise.evaluations.slice(0, 6).map(summarizeEvaluation),
    specialPatterns: exercise.specialPatterns,
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

function buildLocalCoachReply(exercise: Exercise, answer: AnswerState | null, question: string): string {
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
  disabled,
  onChoose,
  onMoveGold,
}: {
  rows: HandRow[];
  tilesByInstance: Map<string, TileInstance>;
  gold: Tile;
  selectedId?: string;
  disabled: boolean;
  onChoose: (tile: TileInstance) => void;
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
                  } ${draggingId === tile.instanceId ? "dragging" : ""}`}
                  key={tile.instanceId}
                  type="button"
                  disabled={disabled}
                  draggable={isGold && !disabled}
                  onClick={() => onChoose(tile)}
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
        练习记录
      </div>
      <div className="stats-grid">
        <Metric label="正确率" value={`${accuracy}%`} />
        <Metric label="连对" value={stats.streak} />
        <Metric label="最佳" value={stats.bestStreak} />
        <Metric label="今日" value={stats.today} />
      </div>
    </div>
  );
}

function CoachPanel({
  messages,
  question,
  loading,
  provider,
  answer,
  onQuestionChange,
  onProviderChange,
  onAsk,
}: {
  messages: CoachMessage[];
  question: string;
  loading: boolean;
  provider: CoachProvider;
  answer: AnswerState | null;
  onQuestionChange: (question: string) => void;
  onProviderChange: (provider: CoachProvider) => void;
  onAsk: (question: string) => void;
}) {
  const quickQuestions = answer
    ? ["我这张打得怎么样？", "为什么推荐打那张？", "用新手话讲一遍"]
    : ["这手牌先看哪里？", "为什么这些牌牌效低？", "金牌现在怎么用？"];

  return (
    <div className="coach-panel">
      <div className="panel-title">
        <Bot size={18} />
        AI 教练
      </div>
      <div className="provider-row">
        <span>服务商</span>
        <select
          value={provider}
          onChange={(event) => onProviderChange(event.target.value as CoachProvider)}
          disabled={loading}
          aria-label="选择 AI 服务商"
        >
          {coachProviders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
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
          placeholder="问：为什么这张牌效最低？"
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
  exercise,
  bestEvaluations,
  hintLevel,
  onNext,
}: {
  answer: AnswerState | null;
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
