'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SendHorizontal, Plus, History, X, Square, Edit3, MessageSquare, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/app/components/Button';
import { LoadingSpinner } from '@/app/components/LoadingSpinner';

// SSE Event types matching backend
interface SSEEvent {
  type: 'text-chunk' | 'text-done' | 'tool-call' | 'tool-result' | 'error' | 'done' | 'cancelled';
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
  error?: string;
}

interface WorkoutDayData {
  dayNumber: number;
  dayName: string;
  workoutType: string;
  workoutColor: string;
  exercises: Array<{
    name: string;
    sets: number;
    reps: number;
    weightType: string;
    weightValue: number;
    restTime?: number;
    exerciseType?: string;
    progression?: string;
    duration?: number;
    distance?: number;
    distanceUnit?: string;
  }>;
}

interface MessageMetadata {
  type?: 'plan_preview' | 'adjustment_preview';
  planId?: string;
  planData?: {
    goal: string;
    weeksDuration: number;
    sessionsPerWeek: number;
    schedule: WorkoutDayData[];
  };
  adjustmentId?: string;
  adjustmentData?: {
    summary: string;
    exercises: Array<{
      name: string;
      exerciseType?: string;
      currentWeight: number;
      currentSets: number;
      currentReps: number;
      currentRepsPerSet?: number[];
      currentWeightsUsed?: number[];
      currentRestTime?: number;
      currentDistanceUnit?: string;
      currentIntervalStructure?: string;
      nextWeight: number;
      nextSets: number;
      nextReps: number;
      nextDistanceUnit?: string;
      nextRestTime?: number;
      nextProgression?: string;
      nextIntervalStructure?: string;
      reasoning: string;
    }>;
  };
  approved?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: MessageMetadata | null;
  createdAt: string;
}

interface ChatData {
  sessionId: string;
  messages: Message[];
  activePlan: {
    id: string;
    goal: string;
  } | null;
  user: {
    name: string | null;
    bodyweight: number | null;
  } | null;
  approvedPlanIds: string[];
  approvedAdjustmentIds: string[];
  adjustmentId?: string | null;
}

export function ChatContent({ data, userId: _userId }: { data: ChatData; userId: string }) {
  const router = useRouter();
  
  const [messages, setMessages] = useState<Message[]>(data.messages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; createdAt: string; messageCount: number }>>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState<string | null>(null);
  const [approvingAdjustment, setApprovingAdjustment] = useState<string | null>(null);
  const [navigatingSession, setNavigatingSession] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const autoStartedRef = useRef<boolean>(false);

  const { activePlan, user } = data;

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sync messages when data changes (when navigating between sessions)
  useEffect(() => {
    setMessages(data.messages);
    // Reset auto-started flag when switching sessions
    autoStartedRef.current = false;
    // Clear navigating state when new data loads
    setNavigatingSession(false);
    
    // Update URL to use sessionId if we're on a new chat URL
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('new') && data.sessionId) {
        // Replace the URL with the actual session ID to prevent creating duplicate sessions
        router.replace(`/chat?session=${data.sessionId}`);
      }
    }
  }, [data.sessionId, data.messages, router]);

  // Handle streaming send
  const handleStreamingSend = useCallback(async (messageContent: string) => {
    if (!messageContent.trim() || isLoading || isStreaming) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent.trim(),
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
          planId: activePlan?.id,
          context: {
            bodyweight: user?.bodyweight,
            userName: user?.name,
            adjustmentId: data.adjustmentId,
          },
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let currentMetadata: MessageMetadata | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event: SSEEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'text-chunk':
                if (event.content) {
                  fullText += event.content;
                  setMessages((prev) =>
                    prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: fullText } : msg))
                  );
                }
                break;

              case 'tool-result':
                if (event.toolResult) {
                  const result = event.toolResult.result as any;
                  if (result.planData) {
                    currentMetadata = {
                      type: 'plan_preview',
                      planData: result.planData,
                    };
                  } else if (result.adjustmentData) {
                    currentMetadata = {
                      type: 'adjustment_preview',
                      adjustmentId: result.adjustmentId,
                      adjustmentData: result.adjustmentData,
                    };
                  }

                  if (currentMetadata) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId ? { ...msg, metadata: currentMetadata } : msg
                      )
                    );
                  }
                }
                break;

              case 'done':
                break;

              case 'error':
                console.error('Stream error:', event.error);
                throw new Error(event.error || 'Stream error');
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      setIsStreaming(false);
      setIsLoading(false);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;

      // Refresh from server
      router.refresh();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      console.error('Streaming error:', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, content: msg.content + '\n\n*[Error occurred]*' } : msg
        )
      );
      setIsStreaming(false);
      setIsLoading(false);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
    }
  }, [data.sessionId, activePlan?.id, user?.bodyweight, user?.name, isLoading, isStreaming, router]);

  // Auto-start workout analysis (no user message)
  const autoStartAnalysis = useCallback(async () => {
    if (isLoading || isStreaming || autoStartedRef.current) return;
    
    autoStartedRef.current = true;

    const assistantMessageId = `stream-${Date.now()}`;
    streamingMessageIdRef.current = assistantMessageId;

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsLoading(true);
    setIsStreaming(true);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: data.sessionId,
          message: '', // Empty message - AI should analyze the workout automatically
          planId: activePlan?.id,
          context: {
            bodyweight: user?.bodyweight,
            userName: user?.name,
            adjustmentId: data.adjustmentId,
          },
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let currentMetadata: MessageMetadata | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event: SSEEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'text-chunk':
                if (event.content) {
                  fullText += event.content;
                  setMessages((prev) =>
                    prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: fullText } : msg))
                  );
                }
                break;

              case 'tool-result':
                if (event.toolResult) {
                  const result = event.toolResult.result as any;
                  if (result.planData) {
                    currentMetadata = {
                      type: 'plan_preview',
                      planData: result.planData,
                    };
                  } else if (result.adjustmentData) {
                    currentMetadata = {
                      type: 'adjustment_preview',
                      adjustmentId: result.adjustmentId,
                      adjustmentData: result.adjustmentData,
                    };
                  }

                  if (currentMetadata) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId ? { ...msg, metadata: currentMetadata } : msg
                      )
                    );
                  }
                }
                break;

              case 'done':
                break;

              case 'error':
                console.error('Stream error:', event.error);
                throw new Error(event.error || 'Stream error');
            }
          } catch {
            // Ignore malformed SSE events
          }
        }
      }

      router.refresh();
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'AbortError') {
        console.log('Request aborted by user');
      } else {
        console.error('Auto-analysis error:', error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: `Error: ${error instanceof Error ? error.message : 'Failed to analyze workout'}`,
                }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
    }
  }, [data, activePlan, user, isLoading, isStreaming, router]);

  // Auto-start workout analysis if adjustmentId is present and this is a NEW session (no existing messages)
  useEffect(() => {
    // Only auto-start if:
    // 1. adjustmentId is present (workout to analyze)
    // 2. Initial data had no messages (new session, not loading existing chat)
    // 3. Current messages are empty
    // 4. Haven't already auto-started
    if (data.adjustmentId && data.messages.length === 0 && messages.length === 0 && !autoStartedRef.current) {
      // Small delay to ensure component is mounted
      const timer = setTimeout(() => {
        autoStartAnalysis();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [data.adjustmentId, data.messages.length, messages.length, autoStartAnalysis]);

  // Stop streaming
  const handleStopStreaming = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  // Send message
  const handleSend = async () => {
    if (!input.trim() || isLoading || isStreaming) return;
    await handleStreamingSend(input.trim());
  };

  // Handle plan approval
  const handleApprove = async (messageId: string, action: 'activate' | 'replace' = 'activate') => {
    if (approvingPlan === `${messageId}-${action}`) return;

    setApprovingPlan(`${messageId}-${action}`);

    try {
      const response = await fetch('/api/plan/apply-from-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, action }),
      });

      const result = await response.json();

      if (!result.success) {
        console.error('Plan approval failed:', result.error);
        alert(`Failed to ${action} plan: ${result.error || 'Unknown error'}`);
        return;
      }

      await fetch('/api/chat/approve-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });

      // Update local state immediately to show approved status
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId && msg.metadata
            ? { ...msg, metadata: { ...msg.metadata, approved: true } }
            : msg
        )
      );

      router.refresh();
    } catch (error) {
      console.error('Approval error:', error);
      alert(`Failed to ${action} plan. Please try again.`);
    } finally {
      setApprovingPlan(null);
    }
  };

  // Handle adjustment approval
  const handleApproveAdjustments = async (adjId: string, messageId: string) => {
    if (approvingAdjustment === adjId) return;

    setApprovingAdjustment(adjId);

    try {
      const approveResponse = await fetch('/api/chat/approve-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, adjustmentId: adjId }),
      });

      const approveResult = await approveResponse.json();
      if (!approveResult.success) {
        throw new Error(approveResult.error || 'Failed to mark message as approved');
      }

      const response = await fetch('/api/workout/apply-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustmentId: adjId }),
      });

      const result = await response.json();

      if (result.success) {
        // Update local state immediately to show approved status
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId && msg.metadata
              ? { ...msg, metadata: { ...msg.metadata, approved: true } }
              : msg
          )
        );
        router.refresh();
      } else {
        console.error('Adjustment approval error:', result.error);
        alert(result.error || 'Failed to apply adjustments');
      }
    } catch (error) {
      console.error('Adjustment approval error:', error);
      alert('Failed to apply adjustments. Please try again.');
    } finally {
      setApprovingAdjustment(null);
    }
  };

  // Fetch sessions for history
  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const response = await fetch('/api/chat/sessions');
      const result = await response.json();
      if (result.success) {
        setSessions(result.data.sessions);
      }
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
          <div className="flex gap-2">
            {!showHistory && (
              <button
                onClick={() => {
                  setShowHistory(true);
                  fetchSessions();
                }}
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
                    // Force a new session by passing a timestamp
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
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No conversation history yet</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`w-full text-left p-4 rounded-lg transition-colors ${
                    session.id === data.sessionId
                      ? 'bg-primary/20 border border-primary'
                      : 'bg-surface hover:bg-surface-elevated'
                  }`}
                >
                  <p className="font-medium text-foreground">{session.title || 'Untitled Conversation'}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{session.messageCount} messages</span>
                    <span>•</span>
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
              onClick={() => {
                setInput("I want to create a new workout plan. ");
                inputRef.current?.focus();
              }}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                <Plus className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="font-medium text-foreground">Create a New Plan</p>
                <p className="text-sm text-muted-foreground">
                  Design a personalized workout schedule
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                setInput("I want to add my current workout plan. ");
                inputRef.current?.focus();
              }}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <p className="font-medium text-foreground">Add Your Current Plan</p>
                <p className="text-sm text-muted-foreground">
                  Tell me about the plan you're already following
                </p>
              </div>
            </button>

            {activePlan && (
              <button
                onClick={() => {
                  setInput("I want to edit my existing workout plan. ");
                  inputRef.current?.focus();
                }}
                className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                  <Edit3 className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Edit Existing Plan</p>
                  <p className="text-sm text-muted-foreground">
                    Modify your current workout plan
                  </p>
                </div>
              </button>
            )}

            <button
              onClick={() => {
                inputRef.current?.focus();
              }}
              className="flex items-center gap-3 p-4 bg-surface rounded-xl text-left hover:bg-surface-elevated transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Ask a Question</p>
                <p className="text-sm text-muted-foreground">
                  Get help or advice
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Loading state when navigating between sessions */}
      {navigatingSession && !showHistory && (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Messages */}
      {!showHistory && !navigatingSession && messages.length > 0 && (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto pb-32">
          <div className="px-4 py-4 space-y-3">
            {messages.map((message) => {
              if (message.role === 'assistant' && !message.content && !message.metadata) {
                return null;
              }

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
                            {message.metadata.planData.schedule.map((day, idx) => (
                              <div key={idx} className="bg-background/30 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: day.workoutColor }} />
                                  <p className="font-semibold text-sm">
                                    {day.dayName} - {day.workoutType}
                                  </p>
                                </div>
                                <div className="space-y-1 text-xs">
                                  {day.exercises.map((ex, exIdx) => (
                                    <div key={exIdx}>
                                      <span className="font-medium">{ex.name}</span>
                                      <span className="text-muted-foreground ml-2">
                                        {ex.sets}×{ex.reps} @ {ex.weightValue}
                                        {ex.weightType === 'BW' ? '% BW' : ex.weightType === '1RM' ? '% 1RM' : ' lbs'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}

                            {/* Approval buttons */}
                            {!message.metadata.approved && (
                              <div className="flex gap-2">
                                {activePlan ? (
                                  <>
                                    <Button
                                      onClick={() => handleApprove(message.id, 'replace')}
                                      disabled={approvingPlan !== null}
                                      fullWidth
                                    >
                                      {approvingPlan === `${message.id}-replace` && <LoadingSpinner size="sm" />}
                                      Replace Current
                                    </Button>
                                    <Button
                                      onClick={() => handleApprove(message.id, 'activate')}
                                      disabled={approvingPlan !== null}
                                      variant="secondary"
                                      fullWidth
                                    >
                                      {approvingPlan === `${message.id}-activate` && <LoadingSpinner size="sm" />}
                                      Save as New
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    onClick={() => handleApprove(message.id, 'activate')}
                                    disabled={approvingPlan !== null}
                                    fullWidth
                                  >
                                    {approvingPlan === `${message.id}-activate` && <LoadingSpinner size="sm" />}
                                    Activate Plan
                                  </Button>
                                )}
                              </div>
                            )}

                            {message.metadata.approved && (
                              <div className="text-center text-success font-medium py-2">✓ Plan Applied Successfully</div>
                            )}
                          </div>
                        )}

                        {/* Adjustment Preview */}
                        {message.metadata?.type === 'adjustment_preview' && message.metadata?.adjustmentData && (
                          <div className="mt-4 pt-4 border-t border-border space-y-3">
                            {message.metadata.adjustmentData.exercises.map((ex, idx) => (
                              <div key={idx} className="bg-background/30 rounded-lg p-3">
                                <p className="font-semibold text-sm mb-3">{ex.name}</p>
                                
                                {/* Current Performance */}
                                <div className="mb-3">
                                  <p className="text-xs font-medium text-muted-foreground mb-1">What you did:</p>
                                  <div className="space-y-0.5 text-xs pl-2">
                                    {(() => {
                                      const isDistance = ex.exerciseType === 'distance';
                                      const isTime = ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time';
                                      const isEMOM = ex.exerciseType === 'emom';
                                      const isInterval = ex.exerciseType === 'interval';
                                      const isAMRAP = ex.exerciseType === 'amrap';
                                      const isTabata = ex.exerciseType === 'tabata';
                                      
                                      // For EMOM, Interval, AMRAP, Tabata: show summary only
                                      if (isEMOM || isInterval || isAMRAP || isTabata) {
                                        const rounds = ex.currentSets;
                                        const repsPerRound = ex.currentReps;
                                        const weight = ex.currentWeight;
                                        
                                        if (isEMOM) {
                                          return (
                                            <div className="text-foreground">
                                              {rounds} rounds completed, {repsPerRound} reps per round{weight > 0 && ` @ ${weight} lbs`}
                                            </div>
                                          );
                                        } else if (isInterval) {
                                          const intervalInfo = ex.currentIntervalStructure ? `: ${ex.currentIntervalStructure}` : '';
                                          return (
                                            <div className="text-foreground">
                                              {rounds} rounds completed{intervalInfo}{weight > 0 && ` @ ${weight} lbs`}
                                            </div>
                                          );
                                        } else if (isAMRAP) {
                                          return (
                                            <div className="text-foreground">
                                              {rounds} rounds completed{weight > 0 && ` @ ${weight} lbs`}
                                            </div>
                                          );
                                        } else if (isTabata) {
                                          return (
                                            <div className="text-foreground">
                                              {rounds} rounds completed{weight > 0 && ` @ ${weight} lbs`}
                                            </div>
                                          );
                                        }
                                      }
                                      
                                      // For other types: show set-by-set if available
                                      if (ex.currentRepsPerSet && Array.isArray(ex.currentRepsPerSet) && ex.currentRepsPerSet.length > 0) {
                                        return ex.currentRepsPerSet.map((value: number, setIdx: number) => {
                                          const distUnit = ex.currentDistanceUnit || 'feet';
                                          const weight = ex.currentWeightsUsed?.[setIdx] ?? ex.currentWeight;
                                          
                                          let displayValue = `${value}`;
                                          if (isDistance) displayValue += ` ${distUnit}`;
                                          else if (isTime) displayValue += ' min';
                                          else displayValue += ' reps';
                                          
                                          return (
                                            <div key={setIdx} className="text-foreground">
                                              Set {setIdx + 1}: {displayValue}
                                              {weight > 0 && ` @ ${weight} lbs`}
                                            </div>
                                          );
                                        });
                                      }
                                      
                                      // Fallback summary
                                      return (
                                        <div className="text-foreground">
                                          {isDistance 
                                            ? `${ex.currentSets}×${ex.currentReps} ${ex.currentDistanceUnit || 'feet'}${ex.currentWeight > 0 ? ` @ ${ex.currentWeight} lbs` : ''}`
                                            : isTime
                                            ? `${ex.currentReps} min`
                                            : `${ex.currentSets}×${ex.currentReps} @ ${ex.currentWeight} lbs`
                                          }
                                        </div>
                                      );
                                    })()}
                                  </div>
                                  {(ex.currentRestTime ?? 0) > 0 && !['emom', 'interval', 'amrap', 'tabata'].includes(ex.exerciseType || '') && (
                                    <p className="text-xs text-muted-foreground mt-1 pl-2">
                                      Rest: {ex.currentRestTime}s between sets
                                    </p>
                                  )}
                                </div>

                                {/* Next Workout */}
                                <div className="mb-3">
                                  <p className="text-xs font-medium text-success mb-1">Next workout:</p>
                                  <div className="text-xs pl-2">
                                    <div className="font-medium text-success">
                                      {ex.exerciseType === 'distance' 
                                        ? `${ex.nextSets}×${ex.nextReps} ${ex.nextDistanceUnit || 'feet'}${ex.nextWeight > 0 ? ` @ ${ex.nextWeight} lbs` : ''}`
                                        : ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time'
                                        ? `${ex.nextSets}×${ex.nextReps} min${ex.nextWeight > 0 ? ` @ ${ex.nextWeight} lbs` : ''}`
                                        : ex.exerciseType === 'emom'
                                        ? `${ex.nextSets} rounds, ${ex.nextReps} reps per round${ex.nextWeight > 0 ? ` @ ${ex.nextWeight} lbs` : ''}`
                                        : ex.exerciseType === 'interval'
                                        ? `${ex.nextSets} rounds${ex.nextIntervalStructure ? `: ${ex.nextIntervalStructure}` : ''}${ex.nextWeight > 0 ? ` @ ${ex.nextWeight} lbs` : ''}`
                                        : ex.exerciseType === 'amrap' || ex.exerciseType === 'tabata'
                                        ? `${ex.nextSets} rounds${ex.nextWeight > 0 ? ` @ ${ex.nextWeight} lbs` : ''}`
                                        : `${ex.nextSets}×${ex.nextReps} @ ${ex.nextWeight} lbs`
                                      }
                                    </div>
                                    {(ex.nextRestTime ?? 0) > 0 && !['emom', 'interval', 'amrap', 'tabata'].includes(ex.exerciseType || '') && (
                                      <p className="text-xs text-success/70 mt-1">
                                        Rest: {ex.nextRestTime}s between sets
                                      </p>
                                    )}
                                    {ex.nextProgression && (
                                      <p className="text-xs text-success/70 mt-1">
                                        Progression: {ex.nextProgression}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
                                  {ex.reasoning}
                                </p>
                              </div>
                            ))}

                            {!message.metadata.approved && message.metadata.adjustmentId && (
                              <Button
                                onClick={() =>
                                  handleApproveAdjustments(message.metadata!.adjustmentId!, message.id)
                                }
                                disabled={approvingAdjustment !== null}
                                fullWidth
                              >
                                {approvingAdjustment === message.metadata.adjustmentId && <LoadingSpinner size="sm" />}
                                Approve All
                              </Button>
                            )}

                            {message.metadata.approved && (
                              <div className="text-center text-success font-medium">✓ Applied to next workout</div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {isStreaming && !messages[messages.length - 1]?.content && (
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

      {/* Input */}
      {!showHistory && !navigatingSession && (
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
