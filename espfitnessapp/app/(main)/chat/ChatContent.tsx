'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SendHorizontal, Plus, History, X, Square, Edit3, MessageSquare, FileText, Loader2, ClipboardList } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/app/components/Button';
import { LoadingSpinner } from '@/app/components/LoadingSpinner';
import { useRestTimer } from '@/app/components/RestTimerBadge';
import type { PlanDayData, ExerciseType, StrengthConfig, DistanceConfig, TimeConfig, AmrapConfig, EmomConfig, RoundBlockConfig, TabataConfig, ProgressionRule } from '@/app/types';

interface AskUserQuestion {
  id: string;
  question: string;
  options: string[];
}

interface SSEEvent {
  type: 'text-chunk' | 'text-done' | 'tool-call' | 'tool-result' | 'ask-user' | 'new-bubble' | 'error' | 'done' | 'cancelled';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  toolResult?: {
    toolCallId: string;
    result: unknown;
  };
  questions?: AskUserQuestion[];
  error?: string;
}

interface EditExercise {
  id: string | null;
  name: string;
  exerciseType: ExerciseType;
  config: Record<string, unknown>;
  progression: Record<string, unknown> | null;
  groupTag: string | null;
  order: number;
  notes: string | null;
}

interface EditWorkoutState {
  id: string;
  name: string;
  color: string;
  exercises: EditExercise[];
}

interface EditPreviewItem {
  workoutTypeId: string;
  editArgs: Record<string, unknown>;
  currentState: EditWorkoutState;
  proposedState: EditWorkoutState;
}

interface MessageMetadata {
  type?: 'plan_preview' | 'edit_preview' | 'edit_result';
  planData?: {
    name: string;
    schedule: PlanDayData[];
  };
  // New: array of edit previews (supports multiple-day edits)
  editPreviews?: EditPreviewItem[];
  // Legacy single edit preview fields (backward compat with old DB records)
  workoutTypeId?: string;
  editArgs?: Record<string, unknown>;
  currentState?: EditWorkoutState;
  proposedState?: EditWorkoutState;
  workoutType?: Record<string, unknown>;
  approved?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: MessageMetadata | null;
  approved?: boolean;
  createdAt: string;
}

interface ChatData {
  sessionId: string;
  messages: Message[];
  activePlan: {
    id: string;
    name: string;
  } | null;
  user: {
    name: string | null;
    bodyweight: number | null;
  } | null;
}

const TOOL_LABELS: Record<string, string> = {
  create_workout_plan: 'Building your workout plan...',
  edit_workout_plan: 'Updating your plan...',
  get_workout_history: 'Fetching workout history...',
  ask_user: 'Preparing questions...',
  write_memory: 'Remembering...',
};

function formatExerciseDisplay(ex: { name: string; exerciseType: ExerciseType; config: Record<string, unknown> }): string {
  const c = ex.config;
  switch (ex.exerciseType) {
    case 'strength': {
      const cfg = c as unknown as StrengthConfig;
      const reps = cfg.repsMin === cfg.repsMax ? `${cfg.repsMin}` : `${cfg.repsMin}-${cfg.repsMax}`;
      const rest = cfg.restSeconds ? ` | Rest ${cfg.restSeconds}s` : '';
      let weightStr: string;
      if (cfg.weightType === 'bodyweight' || (cfg.weightType === 'absolute' && cfg.baseWeight === 0)) {
        weightStr = 'BW';
      } else if (cfg.weightType === 'percentage_1rm') {
        weightStr = `${cfg.baseWeight}% 1RM`;
      } else {
        weightStr = `${cfg.baseWeight} ${cfg.weightUnit}`;
      }
      return `${cfg.sets}×${reps} @ ${weightStr}${rest}${cfg.tempo ? ` | Tempo ${cfg.tempo}` : ''}`;
    }
    case 'distance': {
      const cfg = c as unknown as DistanceConfig;
      const rest = cfg.restSeconds ? ` | Rest ${cfg.restSeconds}s` : '';
      return `${cfg.sets}×${cfg.distanceTarget} ${cfg.distanceUnit}${rest}`;
    }
    case 'time': {
      const cfg = c as unknown as TimeConfig;
      const rest = cfg.restSeconds ? ` | Rest ${cfg.restSeconds}s` : '';
      return `${cfg.sets}×${cfg.durationSeconds}s${rest}`;
    }
    case 'amrap': {
      const cfg = c as unknown as AmrapConfig;
      return `AMRAP ${Math.floor(cfg.timeCap / 60)} min`;
    }
    case 'emom': {
      const cfg = c as unknown as EmomConfig;
      return `EMOM ${cfg.totalMinutes} min`;
    }
    case 'round_block': {
      const cfg = c as unknown as RoundBlockConfig;
      const rest = cfg.restBetweenRounds ? ` | Rest ${cfg.restBetweenRounds}s between rounds` : '';
      return `${cfg.rounds} rounds${rest}`;
    }
    case 'tabata': {
      const cfg = c as unknown as TabataConfig;
      return `Tabata ${cfg.rounds} rounds (${cfg.workSeconds}s work / ${cfg.restSeconds}s rest)`;
    }
    default:
      return '';
  }
}

function formatProgressionDisplay(progression: ProgressionRule | null | undefined): string | null {
  if (!progression || progression.type === 'none') return null;
  if (progression.type === 'linear') {
    return `Progression: +${progression.incrementValue} ${progression.incrementUnit} per session`;
  }
  if (progression.type === 'double_progression') {
    return `Progression: ${progression.repsMin}-${progression.repsMax} reps, +${progression.weightIncrement} ${progression.weightIncrementUnit} at top`;
  }
  return null;
}

export function ChatContent({ data, userId: _userId }: { data: ChatData; userId: string }) {
  const router = useRouter();
  const restTimer = useRestTimer();

  const [messages, setMessages] = useState<Message[]>(data.messages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; createdAt: string; messageCount: number }>>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState<string | null>(null);
  const [approvingEdit, setApprovingEdit] = useState<string | null>(null);
  const [navigatingSession, setNavigatingSession] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<AskUserQuestion[] | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherInputValue, setOtherInputValue] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const toolCallStartRef = useRef<number>(0);
  const streamActiveRef = useRef(false);

  const { activePlan, user } = data;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setMessages(data.messages);
    setNavigatingSession(false);
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('new') && data.sessionId) {
        router.replace(`/chat?session=${data.sessionId}`);
      }
    }
  }, [data.sessionId, data.messages, router]);

  const handleStreamingSend = useCallback(async (messageContent: string, displayContent?: string) => {
    if (!messageContent.trim() || streamActiveRef.current) return;
    streamActiveRef.current = true;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: (displayContent ?? messageContent).trim(),
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = `stream-${Date.now()}`;
    streamingMessageIdRef.current = assistantMessageId;

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: data.sessionId,
          message: messageContent.trim(),
          ...(displayContent && displayContent !== messageContent.trim() ? { displayMessage: displayContent.trim() } : {}),
          planId: activePlan?.id,
          context: {
            bodyweight: user?.bodyweight,
            userName: user?.name,
          },
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      // Track the active bubble — starts as the initial assistant message
      let currentBubbleId = assistantMessageId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          let event: SSEEvent;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          switch (event.type) {
            case 'text-chunk':
              if (event.content) {
                const bubbleId = currentBubbleId;
                setMessages((prev) =>
                  prev.map((msg) => (msg.id === bubbleId ? { ...msg, content: msg.content + event.content! } : msg))
                );
              }
              break;

            case 'new-bubble': {
              // Server is starting a fresh text section after tool calls — create a new message bubble
              const newBubbleId = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              currentBubbleId = newBubbleId;
              setMessages((prev) => [
                ...prev,
                {
                  id: newBubbleId,
                  role: 'assistant' as const,
                  content: '',
                  metadata: null,
                  createdAt: new Date().toISOString(),
                },
              ]);
              break;
            }

            case 'tool-call':
              if (event.toolCall) {
                toolCallStartRef.current = Date.now();
                setActiveToolCall(event.toolCall.name);
              }
              break;

            case 'tool-result': {
              setActiveToolCall(null);
              if (event.toolResult) {
                const result = event.toolResult.result as Record<string, unknown>;
                if (result.planData) {
                  const planData = result.planData as MessageMetadata['planData'];
                  const bubbleId = currentBubbleId;
                  if (planData?.schedule) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === bubbleId
                          ? { ...msg, metadata: { type: 'plan_preview', planData: { name: planData.name, schedule: [] } } }
                          : msg
                      )
                    );
                    for (let i = 0; i < planData.schedule.length; i++) {
                      await new Promise<void>((r) => setTimeout(r, 300));
                      const revealedSchedule = planData.schedule.slice(0, i + 1);
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === bubbleId
                            ? { ...msg, metadata: { type: 'plan_preview', planData: { name: planData.name, schedule: revealedSchedule } } }
                            : msg
                        )
                      );
                    }
                  }
                } else if (result.editPreview) {
                  const ep = result.editPreview as EditPreviewItem;
                  const newPreview: EditPreviewItem = {
                    workoutTypeId: ep.workoutTypeId,
                    editArgs: ep.editArgs,
                    currentState: ep.currentState,
                    proposedState: ep.proposedState,
                  };
                  const bubbleId = currentBubbleId;
                  // Accumulate edit previews — multiple days = multiple previews in same bubble
                  setMessages((prev) =>
                    prev.map((msg) => {
                      if (msg.id !== bubbleId) return msg;
                      const existing = (msg.metadata?.editPreviews as EditPreviewItem[]) || [];
                      return {
                        ...msg,
                        metadata: {
                          type: 'edit_preview' as const,
                          editPreviews: [...existing, newPreview],
                        },
                      };
                    })
                  );
                }
              }
              break;
            }

            case 'ask-user':
              setActiveToolCall(null);
              if (event.questions?.length) {
                setPendingQuestions(event.questions);
                setCurrentQuestionIdx(0);
                setQuestionAnswers({});
                setShowOtherInput(false);
                setOtherInputValue('');
              }
              break;

            case 'done':
              break;

            case 'error':
              console.error('Stream error:', event.error);
              throw new Error(event.error || 'Stream error');
          }
        }
      }

      streamActiveRef.current = false;
      setIsStreaming(false);
      setIsLoading(false);
      setActiveToolCall(null);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
      router.refresh();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        streamActiveRef.current = false;
        streamingMessageIdRef.current = null;
        return;
      }
      console.error('Streaming error:', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, content: msg.content + '\n\n*[Error occurred]*' } : msg
        )
      );
      streamActiveRef.current = false;
      setIsStreaming(false);
      setIsLoading(false);
      setActiveToolCall(null);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
    }
  }, [data.sessionId, activePlan?.id, user?.bodyweight, user?.name, router]);

  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    streamActiveRef.current = false;
    setIsStreaming(false);
    setIsLoading(false);
    setActiveToolCall(null);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading || isStreaming) return;
    await handleStreamingSend(input.trim());
  };

  const handleQuestionAnswer = useCallback(async (answer: string) => {
    if (!pendingQuestions) return;
    const currentQuestion = pendingQuestions[currentQuestionIdx];
    const newAnswers = { ...questionAnswers, [currentQuestion.id]: answer };
    setQuestionAnswers(newAnswers);
    setShowOtherInput(false);
    setOtherInputValue('');

    if (currentQuestionIdx < pendingQuestions.length - 1) {
      setCurrentQuestionIdx((prev) => prev + 1);
    } else {
      const displayText = pendingQuestions.map((q) => newAnswers[q.id]).join('\n');
      const apiText = pendingQuestions.map((q) => `${q.question}: ${newAnswers[q.id]}`).join('\n');
      setPendingQuestions(null);
      setCurrentQuestionIdx(0);
      setQuestionAnswers({});
      await handleStreamingSend(apiText, displayText);
    }
  }, [pendingQuestions, currentQuestionIdx, questionAnswers, handleStreamingSend]);

  const handleApprove = async (messageId: string) => {
    if (approvingPlan) return;
    setApprovingPlan(messageId);

    try {
      const response = await fetch('/api/plan/apply-from-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });

      const result = await response.json();
      if (!result.success) {
        alert(`Failed to apply plan: ${result.error || 'Unknown error'}`);
        return;
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, approved: true, metadata: msg.metadata ? { ...msg.metadata, approved: true } : null } : msg
        )
      );
      router.refresh();
    } catch (error) {
      console.error('Approval error:', error);
      alert('Failed to apply plan. Please try again.');
    } finally {
      setApprovingPlan(null);
    }
  };

  const handleApplyEdit = async (messageId: string) => {
    if (approvingEdit) return;
    setApprovingEdit(messageId);

    try {
      const response = await fetch('/api/plan/apply-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });

      const result = await response.json();
      if (!result.success) {
        alert(`Failed to apply edit: ${result.error || 'Unknown error'}`);
        return;
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, approved: true, metadata: msg.metadata ? { ...msg.metadata, approved: true } : null }
            : msg
        )
      );
      router.refresh();
    } catch (error) {
      console.error('Apply edit error:', error);
      alert('Failed to apply edit. Please try again.');
    } finally {
      setApprovingEdit(null);
    }
  };

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const response = await fetch('/api/chat/sessions');
      const result = await response.json();
      if (result.success) setSessions(result.data.sessions);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSelectSession = (sessionIdToOpen: string) => {
    setShowHistory(false);
    setNavigatingSession(true);
    router.push(`/chat?session=${sessionIdToOpen}`);
  };

  const showMenu = messages.length === 0 && !isLoading && !showHistory && !navigatingSession;

  return (
    <div className="fixed inset-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">ESP Fitness Planner</h1>
          <div className={`flex gap-2 transition-all duration-200 ${restTimer !== null ? 'mr-24' : ''}`}>
            {!showHistory && (
              <button
                onClick={() => { setShowHistory(true); fetchSessions(); }}
                className="p-2 rounded-lg hover:bg-surface transition-colors"
                title="Conversation history"
              >
                <History size={18} className="text-muted-foreground" />
              </button>
            )}
            {(messages.length > 0 || showHistory) && (
              <button
                onClick={() => {
                  if (showHistory) {
                    setShowHistory(false);
                  } else {
                    setNavigatingSession(true);
                    router.push(`/chat?new=${Date.now()}`);
                  }
                }}
                className="p-2 rounded-lg hover:bg-surface transition-colors"
                title={showHistory ? 'Back to chat' : 'New chat'}
              >
                {showHistory ? <X size={18} className="text-muted-foreground" /> : <Plus size={18} className="text-muted-foreground" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* History View */}
      {showHistory && (
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-20">
          <h2 className="text-lg font-semibold text-foreground mb-4">Conversation History</h2>
          {loadingSessions ? (
            <div className="flex items-center justify-center py-8"><LoadingSpinner size="md" /></div>
          ) : sessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No conversation history yet</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full text-left p-4 rounded-lg transition-colors ${
                    session.id === data.sessionId ? 'bg-primary/20 border border-primary' : 'bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <p className="font-medium text-foreground">{session.title || 'Untitled Conversation'}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{session.messageCount} messages</span>
                    <span>&middot;</span>
                    <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Initial Menu */}
      {showMenu && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
          <p className="text-center text-muted-foreground mb-6">What would you like to do?</p>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <button
              onClick={() => handleStreamingSend('I want to create a new workout plan.')}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                <Plus className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="font-medium text-foreground">Create a New Plan</p>
                <p className="text-sm text-muted-foreground">Design a personalized workout schedule</p>
              </div>
            </button>

            <button
              onClick={() => handleStreamingSend('I want to add my current workout plan.')}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="font-medium text-foreground">Add Your Current Plan</p>
                <p className="text-sm text-muted-foreground">Tell me about the plan you&apos;re already following</p>
              </div>
            </button>

            {activePlan && (
              <button
                onClick={() => handleStreamingSend('I want to edit my existing workout plan.')}
                className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                  <Edit3 className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Edit Existing Plan</p>
                  <p className="text-sm text-muted-foreground">Modify your current workout plan</p>
                </div>
              </button>
            )}

            <button
              onClick={() => handleStreamingSend('Can you review my last workout and give me feedback?')}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <ClipboardList className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="font-medium text-foreground">Review My Last Workout</p>
                <p className="text-sm text-muted-foreground">Get feedback on your recent session</p>
              </div>
            </button>

            <button
              onClick={() => handleStreamingSend('I have a question')}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Ask a Question</p>
                <p className="text-sm text-muted-foreground">Get help or advice</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {navigatingSession && !showHistory && (
        <div className="flex-1 flex items-center justify-center"><LoadingSpinner size="lg" /></div>
      )}

      {/* Messages */}
      {!showHistory && !navigatingSession && messages.length > 0 && (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto pb-32">
          <div className="px-4 py-4 space-y-3">
            {messages.map((message) => {
              if (message.role === 'assistant' && !message.content && !message.metadata) {
                return null;
              }

              const isApproved = message.approved || message.metadata?.approved;

              return (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                      message.role === 'user' ? 'bg-primary text-white' : 'bg-surface text-foreground'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <>
                        {message.content && (
                          <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                          </div>
                        )}


                        {/* Plan Preview */}
                        {message.metadata?.type === 'plan_preview' && message.metadata?.planData && (
                          <div className="mt-4 pt-4 border-t border-border space-y-3">
                            <p className="font-semibold text-sm">{message.metadata.planData.name}</p>
                            {message.metadata.planData.schedule.map((day, idx) => (
                              <div key={idx} className="bg-background/30 rounded-lg p-3 animate-[fadeSlideIn_0.3s_ease-out]">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: day.workoutTypeColor }} />
                                  <p className="font-semibold text-sm">
                                    {day.dayName} &ndash; {day.workoutTypeName}
                                  </p>
                                </div>
                                <div className="space-y-1 text-xs">
                                  {day.exercises.map((ex, exIdx) => {
                                    const progressionText = formatProgressionDisplay(ex.progression);
                                    return (
                                      <div key={exIdx} className="space-y-0.5">
                                        <div>
                                          <span className="font-medium">{ex.name}</span>
                                          <span className="text-muted-foreground ml-2">
                                            {formatExerciseDisplay({
                                              name: ex.name,
                                              exerciseType: ex.exerciseType,
                                              config: ex.config as unknown as Record<string, unknown>,
                                            })}
                                          </span>
                                        </div>
                                        {progressionText && (
                                          <p className="text-primary pl-0.5">{progressionText}</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}

                            {!isApproved && (
                              <Button
                                onClick={() => handleApprove(message.id)}
                                disabled={approvingPlan !== null}
                                fullWidth
                              >
                                {approvingPlan === message.id && <LoadingSpinner size="sm" />}
                                {activePlan ? 'Replace Current Plan' : 'Activate Plan'}
                              </Button>
                            )}

                            {isApproved && (
                              <div className="text-center text-success font-medium py-2">Plan Applied</div>
                            )}
                          </div>
                        )}

                        {/* Edit preview — before/after confirmation */}
                        {message.metadata?.type === 'edit_preview' && (() => {
                          // Normalize: support new editPreviews array OR legacy single-edit fields
                          const previews: EditPreviewItem[] =
                            message.metadata.editPreviews ??
                            (message.metadata.currentState && message.metadata.proposedState
                              ? [{
                                  workoutTypeId: message.metadata.workoutTypeId!,
                                  editArgs: message.metadata.editArgs!,
                                  currentState: message.metadata.currentState,
                                  proposedState: message.metadata.proposedState,
                                }]
                              : []);

                          if (previews.length === 0) return null;

                          return (
                            <div className="mt-4 pt-4 border-t border-border space-y-4">
                              {previews.map((ep, epIdx) => {
                                const current = ep.currentState;
                                const proposed = ep.proposedState;
                                const deletedIds = new Set(
                                  ((ep.editArgs?.deleteExerciseIds as string[]) || [])
                                );
                                const updatedIds = new Set(
                                  ((ep.editArgs?.exercises as Array<{ id?: string }>) || [])
                                    .filter((e) => e.id)
                                    .map((e) => e.id as string)
                                );

                                return (
                                  <div key={epIdx} className="space-y-3">
                                    <p className="font-semibold text-sm">
                                      {previews.length > 1 ? `Edit ${epIdx + 1}: ` : 'Proposed edit: '}{proposed.name}
                                    </p>

                                    {/* Before */}
                                    <div className="bg-background/30 rounded-lg p-3">
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Before</p>
                                      <div className="space-y-1">
                                        {current.exercises.map((ex) => (
                                          <div key={ex.id} className={`text-xs ${deletedIds.has(ex.id!) ? 'line-through opacity-40' : ''}`}>
                                            <span className="font-medium">{ex.name}</span>
                                            <span className="text-muted-foreground ml-2">
                                              {formatExerciseDisplay({ name: ex.name, exerciseType: ex.exerciseType, config: ex.config })}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    {/* After */}
                                    <div className="bg-background/30 rounded-lg p-3">
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">After</p>
                                      <div className="space-y-1">
                                        {proposed.exercises.map((ex, idx) => {
                                          const isNew = !ex.id;
                                          const isModified = !isNew && updatedIds.has(ex.id!);
                                          return (
                                            <div
                                              key={ex.id ?? `new-${idx}`}
                                              className={`text-xs ${isNew ? 'text-success' : isModified ? 'text-yellow-400' : ''}`}
                                            >
                                              {isNew && <span className="mr-1 font-bold">+</span>}
                                              <span className="font-medium">{ex.name}</span>
                                              <span className={`ml-2 ${isNew ? 'text-success/80' : isModified ? 'text-yellow-400/80' : 'text-muted-foreground'}`}>
                                                {formatExerciseDisplay({ name: ex.name, exerciseType: ex.exerciseType, config: ex.config })}
                                              </span>
                                            </div>
                                          );
                                        })}
                                        {current.exercises
                                          .filter((e) => deletedIds.has(e.id!))
                                          .map((ex) => (
                                            <div key={`del-${ex.id}`} className="text-xs text-error line-through opacity-60">
                                              <span className="mr-1 font-bold">−</span>
                                              <span className="font-medium">{ex.name}</span>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}

                              {!isApproved ? (
                                <Button
                                  onClick={() => handleApplyEdit(message.id)}
                                  disabled={approvingEdit !== null}
                                  fullWidth
                                >
                                  {approvingEdit === message.id && <LoadingSpinner size="sm" />}
                                  {previews.length > 1 ? 'Confirm All Changes' : 'Confirm Changes'}
                                </Button>
                              ) : (
                                <div className="text-center text-success font-medium py-2">Workout updated</div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Edit result (legacy applied edits) */}
                        {message.metadata?.type === 'edit_result' && (
                          <div className="mt-4 pt-4 border-t border-border">
                            <div className="text-center text-success font-medium py-2">Workout updated</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {isStreaming && activeToolCall && (
              <div className="flex justify-start">
                <div className="bg-surface rounded-2xl px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin flex-shrink-0" />
                    <span>{TOOL_LABELS[activeToolCall] ?? 'Processing...'}</span>
                  </div>
                </div>
              </div>
            )}

            {isStreaming && !activeToolCall && !messages[messages.length - 1]?.content && (
              <div className="flex justify-start">
                <div className="bg-surface rounded-2xl px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Questions Widget */}
      {!showHistory && !navigatingSession && pendingQuestions && !isStreaming && (
        <div className="fixed bottom-16 left-0 right-0 z-30">
          <div className="px-4 py-3 bg-background border-t border-border">
            <div className="max-w-2xl mx-auto">
              <div className="bg-surface rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Question {currentQuestionIdx + 1} of {pendingQuestions.length}
                  </p>
                  <div className="flex gap-1">
                    {pendingQuestions.map((_, i) => (
                      <div
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${i <= currentQuestionIdx ? 'bg-primary' : 'bg-border'}`}
                      />
                    ))}
                  </div>
                </div>

                <p className="font-medium text-foreground text-sm leading-snug">
                  {pendingQuestions[currentQuestionIdx].question}
                </p>

                <div className="flex flex-wrap gap-2">
                  {pendingQuestions[currentQuestionIdx].options.map((option) => (
                    <button
                      key={option}
                      onClick={() => handleQuestionAnswer(option)}
                      className="px-3 py-1.5 rounded-full text-sm bg-background border border-border 
                               hover:border-primary hover:text-primary transition-colors active:scale-95"
                    >
                      {option}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowOtherInput((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors active:scale-95 ${
                      showOtherInput
                        ? 'bg-primary text-white border-primary'
                        : 'bg-background border-border hover:border-primary hover:text-primary'
                    }`}
                  >
                    Other
                  </button>
                </div>

                {showOtherInput && (
                  <div className="flex gap-2 pt-1">
                    <input
                      autoFocus
                      type="text"
                      value={otherInputValue}
                      onChange={(e) => setOtherInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && otherInputValue.trim()) {
                          handleQuestionAnswer(otherInputValue.trim());
                        }
                      }}
                      placeholder="Type your answer..."
                      className="flex-1 px-3 py-2 rounded-xl bg-background border border-border text-foreground
                               text-sm placeholder-muted outline-none focus:border-primary transition-colors"
                    />
                    <button
                      onClick={() => { if (otherInputValue.trim()) handleQuestionAnswer(otherInputValue.trim()); }}
                      disabled={!otherInputValue.trim()}
                      className="p-2 rounded-xl bg-primary text-white disabled:opacity-30 disabled:cursor-not-allowed 
                               hover:bg-primary-hover transition-colors"
                    >
                      <SendHorizontal size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      {!showHistory && !navigatingSession && !(pendingQuestions && !isStreaming) && (
        <div className="fixed bottom-16 left-0 right-0 bg-background border-t border-border z-20">
          <div className="px-4 py-3">
            <div className="flex gap-3 items-end max-w-2xl mx-auto">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask me anything..."
                disabled={isLoading}
                rows={1}
                className="flex-1 px-4 py-3 rounded-2xl bg-surface border border-border 
                         text-foreground placeholder-muted resize-none
                         !outline-none focus-visible:!outline-none focus:ring-0 focus:border-border
                         disabled:opacity-50 disabled:cursor-not-allowed
                         max-h-32 overflow-y-auto"
                style={{ minHeight: '48px' }}
              />
              {isStreaming ? (
                <button
                  onClick={handleStopStreaming}
                  className="p-3 rounded-full bg-white text-background hover:bg-white/90 transition-colors touch-target"
                  title="Stop generating"
                >
                  <Square size={20} className="fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-3 rounded-full bg-primary text-white disabled:opacity-30 
                           disabled:cursor-not-allowed disabled:pointer-events-none hover:bg-primary-hover transition-colors
                           touch-target"
                >
                  <SendHorizontal size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
