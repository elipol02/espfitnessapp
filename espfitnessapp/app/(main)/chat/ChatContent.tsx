'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SendHorizontal, Plus, Edit3, Dumbbell, MessageSquare, History, FileText, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/app/components/Button';

// SSE Event types matching backend
interface SSEEvent {
  type: 'text-chunk' | 'text-done' | 'day-generated' | 'adjustment-generated' | 'error' | 'done' | 'cancelled';
  content?: string;
  day?: WorkoutDayData;
  adjustment?: ExerciseAdjustment;
  planId?: string;
  error?: string;
  progress?: {
    current: number;
    total: number;
    label: string;
  };
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
    progression?: {
      type: string;
      increment: number;
      frequency: string;
    };
    movementDetails?: {
      description: string;
      cues: string[];
      muscles: string[];
    };
    distance?: number;
    distanceUnit?: string;
    intervals?: object;
    tempo?: string;
    timeCap?: number;
  }>;
}

interface ExerciseAdjustment {
  name: string;
  currentWeight: number;
  currentSets: number;
  currentReps: number;
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  reasoning: string;
}

interface MessageMetadata {
  type?: 'plan_preview' | 'plan_created' | 'workout_summary' | 'adjustment_preview';
  planId?: string;
  planData?: Record<string, unknown>;
  adjustmentId?: string;
  adjustmentData?: {
    summary: string;
    exercises: Array<{
      name: string;
      currentWeight: number;
      currentSets: number;
      currentReps: number;
      nextWeight: number;
      nextSets: number;
      nextReps: number;
      reasoning: string;
    }>;
  };
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: MessageMetadata | null;
  createdAt: string;
}

interface PendingAdjustmentData {
  id: string;
  workoutLogId: string;
  workoutType: string;
  completedDate: Date;
  nextWorkoutDate: Date | null;
  suggestions: unknown[];
  status: string;
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
  detectedMode: string | null;
  pendingAdjustment?: PendingAdjustmentData | null;
}

export function ChatContent({ 
  data, 
  userId, 
  isNewSession = false,
  urlMode,
  adjustmentId
}: { 
  data: ChatData; 
  userId: string;
  isNewSession?: boolean;
  urlMode?: string;
  adjustmentId?: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Mode comes from the URL path prop
  const mode = urlMode || data.detectedMode || null;
  const autoSend = searchParams.get('autoSend');

  const [messages, setMessages] = useState<Message[]>(data.messages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [approvedPlans, setApprovedPlans] = useState<Set<string>>(new Set(data.approvedPlanIds));
  const [approvedAdjustments, setApprovedAdjustments] = useState<Set<string>>(new Set());
  const [selectedAction, setSelectedAction] = useState<'create' | 'addCurrent' | 'edit' | 'ask' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const postWorkoutProcessedRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; createdAt: string; messageCount: number }>>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageCountRef = useRef(data.messages.length);
  const autoSendProcessedRef = useRef<string | null>(null);
  
  // Streaming state
  const [streamingText, setStreamingText] = useState('');
  const [streamingDays, setStreamingDays] = useState<WorkoutDayData[]>([]);
  const [streamingAdjustments, setStreamingAdjustments] = useState<ExerciseAdjustment[]>([]);
  const [streamProgress, setStreamProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [streamingPlanId, setStreamingPlanId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Don't destructure sessionId - use data.sessionId directly to avoid stale closure issues
  const { activePlan, user } = data;
  
  // Track current session ID to detect changes
  const prevSessionIdRef = useRef(data.sessionId);

  // Stop streaming
  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
    sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
    
    // If we have streaming text, create a message from it
    if (streamingText) {
      const partialMessage: Message = {
        id: `partial-${Date.now()}`,
        role: 'assistant',
        content: streamingText + '\n\n*[Response stopped]*',
        metadata: streamingPlanId ? {
          type: 'plan_preview',
          planId: streamingPlanId,
          planData: { schedule: streamingDays },
        } : null,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, partialMessage]);
      setStreamingText('');
      setStreamingDays([]);
      setStreamingAdjustments([]);
      setStreamProgress(null);
      setStreamingPlanId(null);
    }
  }, [data.sessionId, streamingText, streamingPlanId, streamingDays]);

  // Send message with streaming
  const handleStreamingSend = useCallback(async (messageContent: string, modeToUse: string) => {
    if (!messageContent.trim() || isLoading || isStreaming) return;

    // Close history if it's open
    if (showHistory) {
      setShowHistory(false);
    }

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: messageContent.trim(),
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);
    setStreamingText('');
    setStreamingDays([]);
    setStreamingAdjustments([]);
    setStreamProgress(null);
    setStreamingPlanId(null);
    
    sessionStorage.setItem(`chat-loading-${data.sessionId}`, 'true');

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: data.sessionId,
          message: messageContent.trim(),
          mode: modeToUse,
          planId: activePlan?.id,
          context: {
            bodyweight: user?.bodyweight,
            userName: user?.name,
            adjustmentId: adjustmentId,
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
      let finalPlanId: string | null = null;
      const collectedDays: WorkoutDayData[] = [];
      const collectedAdjustments: ExerciseAdjustment[] = [];

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
                  setStreamingText(fullText);
                }
                break;
                
              case 'text-done':
                // Text streaming complete
                break;
                
              case 'day-generated':
                if (event.day) {
                  collectedDays.push(event.day);
                  setStreamingDays([...collectedDays]);
                }
                if (event.progress) {
                  setStreamProgress(event.progress);
                }
                break;
                
              case 'adjustment-generated':
                if (event.adjustment) {
                  collectedAdjustments.push(event.adjustment);
                  setStreamingAdjustments([...collectedAdjustments]);
                }
                if (event.progress) {
                  setStreamProgress(event.progress);
                }
                break;
                
              case 'done':
                finalPlanId = event.planId || null;
                setStreamingPlanId(finalPlanId);
                break;
                
              case 'error':
                console.error('Stream error:', event.error);
                throw new Error(event.error || 'Stream error');
                
              case 'cancelled':
                // Stream was cancelled
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Create the final assistant message
      const assistantMessage: Message = {
        id: `stream-${Date.now()}`,
        role: 'assistant',
        content: fullText,
        metadata: finalPlanId ? {
          type: 'plan_preview',
          planId: finalPlanId,
          planData: { schedule: collectedDays, goal: '', weeksDuration: 12, sessionsPerWeek: 4 },
        } : collectedAdjustments.length > 0 ? {
          type: 'adjustment_preview',
          adjustmentId: adjustmentId,
          adjustmentData: {
            summary: '',
            exercises: collectedAdjustments,
          },
        } : null,
        createdAt: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Mark plan as needing approval if we got one
      if (finalPlanId) {
        // Plan was created, don't auto-approve
      }

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled, handled by handleStopStreaming
        return;
      }
      console.error('Streaming error:', error);
    } finally {
      setIsStreaming(false);
      setIsLoading(false);
      setStreamingText('');
      setStreamingDays([]);
      setStreamingAdjustments([]);
      setStreamProgress(null);
      sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
      abortControllerRef.current = null;
      
      // Refresh to get server-side data
      router.refresh();
    }
  }, [data.sessionId, activePlan?.id, user?.bodyweight, user?.name, adjustmentId, isLoading, isStreaming, showHistory, router]);

  // Reset state when session changes (switching conversations)
  useEffect(() => {
    if (prevSessionIdRef.current !== data.sessionId) {
      // Session changed - reset all state
      setMessages(data.messages);
      setInput('');
      setIsLoading(false);
      setSelectedAction(null);
      setShowHistory(false);
      sessionStorage.removeItem(`chat-loading-${prevSessionIdRef.current}`);
      prevSessionIdRef.current = data.sessionId;
      lastMessageCountRef.current = data.messages.length;
      return;
    }
  }, [data.sessionId, data.messages]);

  // Sync messages when session changes (e.g., new session created or data refreshed)
  useEffect(() => {
    // Skip if we just changed sessions (handled above)
    if (prevSessionIdRef.current !== data.sessionId) {
      return;
    }

    const prevCount = lastMessageCountRef.current;
    const newCount = data.messages.length;
    
    // If we're loading, check if we got an assistant response
    if (isLoading) {
      // Check if server has more messages than before AND last message is from assistant
      if (newCount > prevCount && data.messages[newCount - 1]?.role === 'assistant') {
        // AI responded! Update with server messages
        setMessages(data.messages);
        setIsLoading(false);
        sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
      }
      // Otherwise, keep current messages (includes optimistic user message and loader)
      // Don't sync until we get the assistant response
    } else {
      // Not loading - normal case: sync from server
      setMessages(data.messages);
    }
    
    if (data.messages.length === 0) {
      setInput('');
    }
    
    lastMessageCountRef.current = newCount;
  }, [data.sessionId, data.messages.length, data.messages, isLoading, messages.length]);

  // Sync approved plans from server
  useEffect(() => {
    setApprovedPlans(new Set(data.approvedPlanIds));
  }, [data.approvedPlanIds]);

  // Focus input when action is selected
  useEffect(() => {
    if (selectedAction && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedAction]);

  // Update URL with session ID after creation
  useEffect(() => {
    if (isNewSession && data.sessionId && mode) {
      // Update URL with session parameter while preserving the mode path
      const currentPath = mode ? `/chat/${mode}` : '/chat';
      router.replace(`${currentPath}?session=${data.sessionId}`);
    }
  }, [isNewSession, data.sessionId, mode, router]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle initial mode - only set once on mount, not on every mode change
  const initialModeSet = useRef(false);
  useEffect(() => {
    if (initialModeSet.current) return;
    
    if (mode === 'create' && messages.length === 0) {
      // Check for initial goal from onboarding
      const initialGoal = sessionStorage.getItem('initialGoal');
      if (initialGoal) {
        sessionStorage.removeItem('initialGoal');
        setInput(initialGoal);
      }
      setSelectedAction('create');
      initialModeSet.current = true;
    } else if (mode === 'edit' && messages.length === 0) {
      setSelectedAction('edit');
      initialModeSet.current = true;
    } else if (mode === 'ask' && messages.length === 0) {
      setSelectedAction('ask');
      initialModeSet.current = true;
    }
  }, [mode, messages.length]);

  // Handle post-workout mode - automatically analyze the completed workout (now uses streaming)
  useEffect(() => {
    if (mode === 'post_workout' && adjustmentId && messages.length === 0 && !isLoading && !isStreaming) {
      const postWorkoutKey = `${data.sessionId}-${adjustmentId}`;
      
      // Check if we've already processed this adjustment
      if (postWorkoutProcessedRef.current === postWorkoutKey) {
        return;
      }
      
      postWorkoutProcessedRef.current = postWorkoutKey;
      
      // Use streaming to analyze the workout
      handleStreamingSend('Analyze my completed workout and suggest weights for next time.', 'post_workout');
    }
  }, [mode, adjustmentId, messages.length, isLoading, isStreaming, data.sessionId, handleStreamingSend]);

  // Handle auto-send from URL parameter (now uses streaming)
  useEffect(() => {
    if (autoSend && messages.length === 0 && !isLoading && !isStreaming) {
      const autoSendKey = `${data.sessionId}-${autoSend}`;
      
      // Check if we've already processed this exact auto-send for this session
      if (autoSendProcessedRef.current === autoSendKey) {
        return;
      }
      
      autoSendProcessedRef.current = autoSendKey;
      
      const messageToSend = decodeURIComponent(autoSend);
      if (messageToSend.trim()) {
        handleStreamingSend(messageToSend.trim(), mode || 'general');
      }
    }
  }, [autoSend, messages.length, isLoading, isStreaming, data.sessionId, mode, handleStreamingSend]);

  // Send message (now uses streaming)
  const handleSend = async () => {
    if (!input.trim() || isLoading || isStreaming) return;
    await handleStreamingSend(input.trim(), mode || 'general');
  };

  // Check if we should show loading on mount (persisted from previous navigation)
  useEffect(() => {
    const wasLoading = sessionStorage.getItem(`chat-loading-${data.sessionId}`);
    if (wasLoading === 'true') {
      // Check if the last message is already an assistant message
      // If so, the response came while we were away - don't show loading
      const lastMessage = data.messages[data.messages.length - 1];
      if (lastMessage?.role === 'assistant') {
        sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
        setIsLoading(false);
        return;
      }
      
      // Otherwise, show loading
      setIsLoading(true);
    }
  }, [data.sessionId, data.messages]);

  // Poll for new messages when loading (only if not streaming - streaming handles its own updates)
  useEffect(() => {
    if (isLoading && !isStreaming) {
      // Poll by refreshing data from server
      const pollInterval = setInterval(() => {
        router.refresh();
      }, 2000);

      // Stop polling after 60 seconds
      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        setIsLoading(false);
        sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
      }, 60000);

      return () => {
        clearInterval(pollInterval);
        clearTimeout(timeout);
      };
    }
  }, [isLoading, isStreaming, router, data.sessionId]);

  // Handle sending message when an action is selected (now uses streaming)
  const handleActionSend = async () => {
    if (!input.trim() || isLoading || isStreaming || !selectedAction) return;

    const modeMap: Record<string, string> = {
      'create': 'create',
      'addCurrent': 'create',
      'edit': 'create',
      'ask': 'general',
    };

    const modeToUse = modeMap[selectedAction] || 'general';
    const messageToSend = input.trim();
    
    // Clear the selected action
    setSelectedAction(null);
    
    // Use streaming send
    await handleStreamingSend(messageToSend, modeToUse);
  };


  // Handle plan approval
  const handleApprove = async (planId: string, action: 'activate' | 'replace' = 'activate') => {
    try {
      await fetch(`/api/plan/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', action }),
      });

      // Mark plan as approved in UI
      setApprovedPlans((prev) => new Set(prev).add(planId));
      router.refresh();
    } catch (error) {
      console.error('Approval error:', error);
    }
  };

  // Handle adjustment approval
  const handleApproveAdjustments = async (adjId: string) => {
    try {
      const response = await fetch('/api/workout/apply-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustmentId: adjId }),
      });

      const result = await response.json();

      if (result.success) {
        setApprovedAdjustments((prev) => new Set(prev).add(adjId));
        router.refresh();
      } else {
        console.error('Adjustment approval error:', result.error);
      }
    } catch (error) {
      console.error('Adjustment approval error:', error);
    }
  };

  // Start new chat (shows menu without loading existing session)
  const handleNewChat = () => {
    // Navigate to chat menu with new=true to show action selection
    router.push('/chat?new=true');
  };

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
    // Determine the path based on current mode
    const basePath = mode && mode !== 'general' ? `/chat/${mode}` : '/chat';
    router.push(`${basePath}?session=${sessionIdToOpen}`);
  };

  return (
    <div className="fixed inset-0 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">ESP Fitness Planner</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'create' || selectedAction === 'create' || selectedAction === 'addCurrent'
                ? 'Creating a new plan'
                : mode === 'edit' || selectedAction === 'edit'
                ? 'Editing your plan'
                : mode === 'submit'
                ? 'Logging workout'
                : mode === 'post_workout'
                ? 'Workout Analysis'
                : selectedAction === 'ask'
                ? 'Ask me anything'
                : 'Ask me anything'}
            </p>
          </div>
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
            {(messages.length > 0 || showHistory || selectedAction) && (
              <button
                onClick={() => {
                  if (showHistory) {
                    setShowHistory(false);
                  } else if (selectedAction && messages.length === 0) {
                    setSelectedAction(null);
                    // Update URL in background without causing navigation
                    const sessionParam = data.sessionId ? `?session=${data.sessionId}` : '';
                    window.history.replaceState({}, '', `/chat${sessionParam}`);
                  } else {
                    handleNewChat();
                  }
                }}
                className="p-2 rounded-lg hover:bg-surface transition-colors"
                title={showHistory ? "Back to menu" : (selectedAction && messages.length === 0) ? "Back to menu" : "New chat"}
              >
                <Plus size={18} className="text-muted-foreground" />
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
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
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
                  <p className="font-medium text-foreground">
                    {session.title || 'Untitled Conversation'}
                  </p>
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

      {/* Quick Actions or Action Card */}
      {!showHistory && messages.length === 0 && !isLoading && !selectedAction && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
          <p className="text-center text-muted-foreground mb-6">
            What would you like to do?
          </p>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <button
              onClick={() => {
                setSelectedAction('create');
                // Update URL in background without causing navigation
                const sessionParam = data.sessionId ? `?session=${data.sessionId}` : '';
                window.history.replaceState({}, '', `/chat/create${sessionParam}`);
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
                setSelectedAction('addCurrent');
                // Update URL in background without causing navigation
                const sessionParam = data.sessionId ? `?session=${data.sessionId}` : '';
                window.history.replaceState({}, '', `/chat/create${sessionParam}`);
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
                  setSelectedAction('edit');
                  // Update URL in background without causing navigation
                  const sessionParam = data.sessionId ? `?session=${data.sessionId}` : '';
                  window.history.replaceState({}, '', `/chat/edit${sessionParam}`);
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
                setSelectedAction('ask');
                // Update URL in background without causing navigation
                const sessionParam = data.sessionId ? `?session=${data.sessionId}` : '';
                window.history.replaceState({}, '', `/chat/ask${sessionParam}`);
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

      {/* Action Card - shown when an action is selected */}
      {!showHistory && messages.length === 0 && !isLoading && selectedAction && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-32">
          <div className="w-full max-w-md bg-surface rounded-xl p-6 space-y-3">
            {selectedAction === 'create' && (
              <>
                <h2 className="text-lg font-semibold text-foreground">Create a New Plan</h2>
                <p className="text-sm text-muted-foreground">Tell me about your fitness goals and I'll create a personalized workout plan.</p>
                <p className="text-xs text-muted-foreground opacity-70">Example: I want to build muscle, workout 4 days a week, have access to a full gym...</p>
              </>
            )}

            {selectedAction === 'addCurrent' && (
              <>
                <h2 className="text-lg font-semibold text-foreground">Add Your Current Plan</h2>
                <p className="text-sm text-muted-foreground">Paste or describe the workout plan you're currently following, and I'll help you track it.</p>
                <p className="text-xs text-muted-foreground opacity-70">Example: Monday - Chest/Triceps: Bench press 3x8, Incline DB press 3x10... Tuesday - Rest...</p>
              </>
            )}

            {selectedAction === 'edit' && (
              <>
                <h2 className="text-lg font-semibold text-foreground">Edit Existing Plan</h2>
                <p className="text-sm text-muted-foreground">What would you like to change about your current workout plan?</p>
                <p className="text-xs text-muted-foreground opacity-70">Example: I want to add more leg exercises, reduce session count to 3 days, switch bench press to dumbbells...</p>
              </>
            )}

            {selectedAction === 'ask' && (
              <>
                <h2 className="text-lg font-semibold text-foreground">Ask a Question</h2>
                <p className="text-sm text-muted-foreground">What would you like to know?</p>
                <p className="text-xs text-muted-foreground opacity-70">Example: How can I improve my bench press? What should I eat before a workout?...</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      {!showHistory && (messages.length > 0 || isLoading) && (
        <div className="flex-1 overflow-y-auto pb-32">
          <div className="px-4 py-4 space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  message.role === 'user'
                    ? 'bg-primary text-white'
                    : 'bg-surface text-foreground'
                }`}
              >
                {message.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : (
                  <>
                    {(() => {
                      // Strip JSON blocks if we have metadata (they're shown in preview cards)
                      const displayContent = (message.metadata?.type === 'plan_preview' || message.metadata?.type === 'adjustment_preview')
                        ? message.content.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim()
                        : message.content;
                      
                      // Only render if there's content to show
                      return displayContent ? (
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                              li: ({ children }) => <li className="text-foreground">{children}</li>,
                              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                              em: ({ children }) => <em className="italic">{children}</em>,
                              code: ({ children }) => (
                                <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                              ),
                              pre: ({ children }) => (
                                <pre className="bg-background/50 p-3 rounded-lg overflow-x-auto mb-2">{children}</pre>
                              ),
                              h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
                              a: ({ href, children }) => (
                                <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">
                                  {children}
                                </a>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-2 border-primary pl-3 italic text-muted-foreground">
                                  {children}
                                </blockquote>
                              ),
                            }}
                          >
                            {displayContent}
                          </ReactMarkdown>
                        </div>
                      ) : null;
                    })()}
                  </>
                )}

                {/* Plan Preview */}
                {message.metadata?.type === 'plan_preview' && message.metadata?.planData && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    {(() => {
                      const plan = message.metadata.planData as any;
                      return (
                        <>
                          <div className="text-xs text-muted-foreground">
                            {plan.weeksDuration} weeks • {plan.sessionsPerWeek} sessions/week
                          </div>
                          {plan.schedule?.map((day: any, idx: number) => (
                            <div key={idx} className="bg-background/30 rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: day.workoutColor }}
                                />
                                <p className="font-semibold text-sm">
                                  {day.dayName} - {day.workoutType}
                                </p>
                              </div>
                              <div className="space-y-2">
                                {day.exercises?.map((ex: any, exIdx: number) => {
                                  const formatExercise = () => {
                                    const type = ex.exerciseType || 'strength';
                                    const formatWeight = () => {
                                      if (ex.weightType === '1RM') return `${Math.round(ex.weightValue * 100)}% 1RM`;
                                      if (ex.weightType === 'BW') return `${Math.round(ex.weightValue * 100)}% BW`;
                                      if (ex.weightValue === 0) return '';
                                      return `${ex.weightValue} lbs`;
                                    };
                                    
                                    switch (type) {
                                      case 'cardio_time':
                                      case 'mobility_time':
                                        return `${ex.reps} min`;
                                      case 'distance':
                                        const weight = ex.weightValue > 0 ? ` @ ${formatWeight()}` : '';
                                        return `${ex.sets} × ${ex.distance} ${ex.distanceUnit || 'feet'}${weight}`;
                                      case 'interval':
                                        if (ex.intervals) {
                                          const { rounds, phases } = ex.intervals;
                                          if (phases?.length === 2) {
                                            return `${rounds} rounds: ${Math.floor(phases[0].duration / 60)}min ${phases[0].name} / ${Math.floor(phases[1].duration / 60)}min ${phases[1].name}`;
                                          }
                                          return `${rounds} rounds interval`;
                                        }
                                        return 'Interval';
                                      case 'amrap':
                                        return `AMRAP ${Math.floor((ex.timeCap || 600) / 60)} min`;
                                      case 'emom':
                                        return `EMOM ${ex.sets} min × ${ex.reps} reps`;
                                      case 'tabata':
                                        return `Tabata ${ex.sets} rounds`;
                                      case 'tempo':
                                        return `${ex.sets}×${ex.reps} @ tempo ${ex.tempo || '3-1-3-1'}`;
                                      default:
                                        return `${ex.sets}×${ex.reps} @ ${formatWeight()}`;
                                    }
                                  };
                                  
                                  return (
                                    <div key={exIdx} className="text-xs">
                                      <span className="font-medium">{ex.name}</span>
                                      <span className="text-muted-foreground ml-2">
                                        {formatExercise()}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Approval buttons or approved status if this is a plan preview */}
                {message.metadata?.type === 'plan_preview' && message.metadata?.planId && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {approvedPlans.has(message.metadata.planId as string) ? (
                      <div className="text-center text-success font-medium">
                        ✓ Saved
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activePlan ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleApprove(message.metadata!.planId as string, 'replace')}
                              className="flex-1"
                            >
                              Replace Current
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleApprove(message.metadata!.planId as string, 'activate')}
                              className="flex-1"
                            >
                              Save as New
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleApprove(message.metadata!.planId as string, 'activate')}
                            fullWidth
                          >
                            Activate Plan
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setInput("I'd like to make some changes...")}
                          fullWidth
                        >
                          Request Changes
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Adjustment Preview */}
                {message.metadata?.type === 'adjustment_preview' && message.metadata?.adjustmentData && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    {(() => {
                      const adjustment = message.metadata.adjustmentData;
                      return (
                        <>
                          <div className="text-sm text-muted-foreground mb-2">
                            {adjustment.summary}
                          </div>
                          {adjustment.exercises?.map((ex, idx) => (
                            <div key={idx} className="bg-background/30 rounded-lg p-3">
                              <p className="font-semibold text-sm mb-2">{ex.name}</p>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">
                                  {ex.currentSets}×{ex.currentReps} @ {ex.currentWeight} lbs
                                </span>
                                <span className="text-primary">→</span>
                                <span className="font-medium text-success">
                                  {ex.nextSets}×{ex.nextReps} @ {ex.nextWeight} lbs
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{ex.reasoning}</p>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Adjustment approval buttons */}
                {message.metadata?.type === 'adjustment_preview' && message.metadata?.adjustmentId && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {approvedAdjustments.has(message.metadata.adjustmentId as string) ? (
                      <div className="text-center text-success font-medium">
                        ✓ Applied to next workout
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproveAdjustments(message.metadata!.adjustmentId as string)}
                          fullWidth
                        >
                          Approve All
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setInput("I'd like to adjust...")}
                          fullWidth
                        >
                          Modify Suggestions
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming message */}
          {isStreaming && streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-surface rounded-2xl px-4 py-2.5 text-foreground">
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="text-foreground">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      code: ({ children }) => (
                        <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                      ),
                      pre: ({ children }) => (
                        <pre className="bg-background/50 p-3 rounded-lg overflow-x-auto mb-2">{children}</pre>
                      ),
                    }}
                  >
                    {streamingText.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim() || streamingText}
                  </ReactMarkdown>
                </div>

                {/* Streaming days preview */}
                {streamingDays.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Generating plan...
                    </div>
                    {streamingDays.map((day, idx) => (
                      <div key={idx} className="bg-background/30 rounded-lg p-3 animate-fade-in">
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: day.workoutColor }}
                          />
                          <p className="font-semibold text-sm">
                            {day.dayName} - {day.workoutType}
                          </p>
                        </div>
                        <div className="space-y-1">
                          {day.exercises?.slice(0, 3).map((ex, exIdx) => (
                            <div key={exIdx} className="text-xs">
                              <span className="font-medium">{ex.name}</span>
                              <span className="text-muted-foreground ml-2">
                                {ex.sets}×{ex.reps}
                              </span>
                            </div>
                          ))}
                          {day.exercises && day.exercises.length > 3 && (
                            <div className="text-xs text-muted-foreground">
                              +{day.exercises.length - 3} more exercises
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Streaming adjustments preview */}
                {streamingAdjustments.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    {streamingAdjustments.map((adj, idx) => (
                      <div key={idx} className="bg-background/30 rounded-lg p-3 animate-fade-in">
                        <p className="font-semibold text-sm mb-2">{adj.name}</p>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">
                            {adj.currentSets}×{adj.currentReps} @ {adj.currentWeight} lbs
                          </span>
                          <span className="text-primary">→</span>
                          <span className="font-medium text-success">
                            {adj.nextSets}×{adj.nextReps} @ {adj.nextWeight} lbs
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading indicator with stop button */}
          {(isLoading || isStreaming) && (
            <div className="flex justify-start items-center gap-2">
              <div className="bg-surface rounded-2xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted rounded-full animate-pulse" />
                    <span className="w-2 h-2 bg-muted rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-muted rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                  {streamProgress && (
                    <span className="text-xs text-muted-foreground">
                      {streamProgress.label} ({streamProgress.current}/{streamProgress.total})
                    </span>
                  )}
                  {!streamProgress && isStreaming && (
                    <span className="text-xs text-muted-foreground">
                      {mode === 'create' || mode === 'edit' ? 'Generating plan...' :
                       mode === 'post_workout' ? 'Analyzing workout...' : 'Thinking...'}
                    </span>
                  )}
                </div>
              </div>
              {isStreaming && (
                <button
                  onClick={handleStopStreaming}
                  className="p-2 rounded-lg bg-error/20 hover:bg-error/30 transition-colors"
                  title="Stop generating"
                >
                  <Square size={16} className="text-error fill-error" />
                </button>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
      )}

      {/* Input - Fixed at bottom above nav */}
      {!showHistory && (messages.length > 0 || isLoading || selectedAction) && (
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
                  if (selectedAction) {
                    handleActionSend();
                  } else {
                    handleSend();
                  }
                }
              }}
              placeholder={
                selectedAction === 'create' ? "Describe your fitness goals..." :
                selectedAction === 'edit' ? "What would you like to change..." :
                selectedAction === 'ask' ? "Ask a question..." :
                "Type a message..."
              }
              disabled={isLoading}
              rows={1}
              className="flex-1 px-4 py-3 rounded-2xl bg-surface border border-border 
                       text-foreground placeholder-muted resize-none
                       !outline-none focus-visible:!outline-none focus:ring-0 focus:border-border
                       disabled:opacity-50 disabled:cursor-not-allowed
                       max-h-32 overflow-y-auto"
              style={{ minHeight: '48px' }}
            />
            <button
              onClick={selectedAction ? handleActionSend : handleSend}
              disabled={!input.trim() || isLoading}
              className="p-3 rounded-full bg-primary text-white disabled:opacity-30 
                       disabled:cursor-not-allowed disabled:pointer-events-none hover:bg-primary-hover transition-colors
                       touch-target"
            >
              <SendHorizontal size={20} />
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
