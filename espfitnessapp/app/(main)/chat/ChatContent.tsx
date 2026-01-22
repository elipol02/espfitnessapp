'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SendHorizontal, Plus, Edit3, MessageSquare, History, FileText, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/app/components/Button';
import { LoadingSpinner } from '@/app/components/LoadingSpinner';

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
    // Time-based fields
    duration?: number;     // Duration in minutes (cardio_time, mobility_time)
    // Distance fields
    distance?: number;
    distanceUnit?: string;
    // Interval fields
    intervals?: object;
    // Tempo fields
    tempo?: string;
    // AMRAP/EMOM/Tabata fields
    timeCap?: number;
    movements?: Array<{
      name: string;
      reps?: number;
      duration?: number;
      weight?: number;
      weightType?: string;
    }>;
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
  }>;
}

interface ExerciseAdjustment {
  name: string;
  currentWeight: number;
  currentSets: number;
  currentReps: number;
  currentDuration?: number;
  currentDistance?: number;
  currentTimeCap?: number;
  currentIntervals?: object;
  nextWeight: number;
  nextSets: number;
  nextReps: number;
  nextDuration?: number;
  nextDistance?: number;
  nextTimeCap?: number;
  nextIntervals?: object;
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
  approvedAdjustmentIds: string[];
  detectedMode: string | null;
  pendingAdjustment?: PendingAdjustmentData | null;
}

export function ChatContent({ 
  data, 
  userId: _userId, 
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
  // Track mode in state - starts with URL mode or detected mode, can be updated by action selection
  const [currentMode, setCurrentMode] = useState<string | null>(urlMode || data.detectedMode || null);
  const mode = currentMode;
  const autoSend = searchParams.get('autoSend');

  // Sync currentMode when urlMode changes (URL navigation)
  useEffect(() => {
    if (urlMode && urlMode !== currentMode) {
      setCurrentMode(urlMode);
    }
  }, [urlMode, currentMode]);

  // Initialize messages - check for saved streaming state first
  const [messages, setMessages] = useState<Message[]>(() => {
    // Check if we have saved streaming state to restore
    if (typeof window !== 'undefined') {
      const savedState = sessionStorage.getItem(`chat-streaming-${data.sessionId}`);
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          // Only restore if state is recent (within last 5 minutes)
          if (Date.now() - state.timestamp <= 5 * 60 * 1000) {
            // Create the streaming message
            const streamingMessage: Message = {
              id: state.messageId,
              role: 'assistant',
              content: state.content || '',
              metadata: state.metadata,
              createdAt: new Date().toISOString(),
            };
            // Return data.messages + the streaming message
            const hasMessage = data.messages.some(m => m.id === state.messageId);
            if (!hasMessage) {
              return [...data.messages, streamingMessage];
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
    return data.messages;
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [_approvedPlans, setApprovedPlans] = useState<Set<string>>(new Set(data.approvedPlanIds));
  const [_approvedAdjustments, setApprovedAdjustments] = useState<Set<string>>(new Set(data.approvedAdjustmentIds));
  const [selectedAction, setSelectedAction] = useState<'create' | 'addCurrent' | 'edit' | 'ask' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const postWorkoutProcessedRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; createdAt: string; messageCount: number }>>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [switchingSession, setSwitchingSession] = useState(false);
  const [showNewChatMenu, setShowNewChatMenu] = useState(false);
  const [startingNewChat, setStartingNewChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageCountRef = useRef(data.messages.length);
  const autoSendProcessedRef = useRef<string | null>(null);
  const autoScrollDisabledRef = useRef(false); // Disabled when user scrolls up during streaming
  
  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGeneratingDays, setIsGeneratingDays] = useState(false); // Show "Generating workout..." loader
  const [streamProgress, setStreamProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef(''); // Track content as it streams for saving on stop
  const skipNextSyncRef = useRef(false); // Skip server sync after stopping streaming
  const streamStateRestoredRef = useRef(false); // Track if we've restored streaming state

  // Helper to save streaming state to sessionStorage
  const saveStreamingState = useCallback((
    messageId: string,
    content: string,
    metadata: MessageMetadata | null,
    generating: boolean,
    progress: { current: number; total: number; label: string } | null
  ) => {
    const state = {
      messageId,
      content,
      metadata,
      isGeneratingDays: generating,
      streamProgress: progress,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(`chat-streaming-${data.sessionId}`, JSON.stringify(state));
  }, [data.sessionId]);

  // Helper to clear streaming state from sessionStorage
  const clearStreamingState = useCallback(() => {
    sessionStorage.removeItem(`chat-streaming-${data.sessionId}`);
  }, [data.sessionId]);

  // Don't destructure sessionId - use data.sessionId directly to avoid stale closure issues
  const { activePlan, user } = data;
  
  // Track current session ID to detect changes
  const prevSessionIdRef = useRef(data.sessionId);

  // Restore streaming state flags on mount (messages are already restored in useState initializer)
  useEffect(() => {
    if (streamStateRestoredRef.current) return undefined;
    streamStateRestoredRef.current = true;

    const savedState = sessionStorage.getItem(`chat-streaming-${data.sessionId}`);
    if (!savedState) return undefined;

    try {
      const state = JSON.parse(savedState);
      // Only restore if state is recent (within last 5 minutes)
      if (Date.now() - state.timestamp > 5 * 60 * 1000) {
        clearStreamingState();
        return undefined;
      }

      // Check if stream already completed on server
      const lastServerMessage = data.messages[data.messages.length - 1];
      if (lastServerMessage?.role === 'assistant' && lastServerMessage.content) {
        // Stream completed while away, clear saved state
        clearStreamingState();
        return undefined;
      }

      // Restore streaming state flags (messages already restored in useState initializer)
      setIsLoading(true);
      setIsStreaming(true);
      setIsGeneratingDays(state.isGeneratingDays || false);
      setStreamProgress(state.streamProgress || null);
      streamingMessageIdRef.current = state.messageId;
      streamingContentRef.current = state.content || '';
      skipNextSyncRef.current = true;

      // Set up polling to check when stream completes on server
      const pollInterval = setInterval(() => {
        router.refresh();
      }, 2000);

      // Stop polling after 3 minutes
      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        setIsLoading(false);
        setIsStreaming(false);
        setIsGeneratingDays(false);
        clearStreamingState();
      }, 3 * 60 * 1000);

      // Cleanup
      return () => {
        clearInterval(pollInterval);
        clearTimeout(timeout);
      };
    } catch {
      clearStreamingState();
      return undefined;
    }
  }, [data.sessionId, data.messages, clearStreamingState, router]);

  // Stop streaming
  const handleStopStreaming = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Prevent the sync effect from overwriting our local messages
    skipNextSyncRef.current = true;
    
    setIsStreaming(false);
    setIsLoading(false);
    setIsGeneratingDays(false);
    setStreamProgress(null);
    sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
    
    // Clear persisted streaming state
    clearStreamingState();
    
    // Save partial response to database
    const partialContent = streamingContentRef.current;
    if (streamingMessageIdRef.current && partialContent) {
      // Save to database
      try {
        await fetch('/api/chat/save-partial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: data.sessionId,
            content: partialContent,
          }),
        });
      } catch (e) {
        console.error('Failed to save partial response:', e);
      }
      
      streamingMessageIdRef.current = null;
      streamingContentRef.current = '';
    }
  }, [data.sessionId, clearStreamingState]);

  // Send message with streaming
  const handleStreamingSend = useCallback(async (messageContent: string, modeToUse: string) => {
    if (!messageContent.trim() || isLoading || isStreaming) return;

    // Close history if it's open
    if (showHistory) {
      setShowHistory(false);
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent.trim(),
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    // Create the assistant message placeholder immediately
    const assistantMessageId = `stream-${Date.now()}`;
    streamingMessageIdRef.current = assistantMessageId;
    
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    // Add both messages at once
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);
    setStreamProgress(null);
    streamingContentRef.current = ''; // Reset content ref
    autoScrollDisabledRef.current = false; // Re-enable auto-scroll for new message
    
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
                  streamingContentRef.current = fullText; // Track for save on stop
                  // Update message content in place
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId ? { ...msg, content: fullText } : msg
                  ));
                  // Save state for navigation persistence
                  saveStreamingState(assistantMessageId, fullText, null, false, null);
                }
                break;
                
              case 'text-done':
                // Text streaming complete - if this is a plan creation, show generating indicator
                if (modeToUse === 'create' || modeToUse === 'edit') {
                  setIsGeneratingDays(true);
                  saveStreamingState(assistantMessageId, fullText, null, true, null);
                }
                break;
                
              case 'day-generated':
                if (event.day) {
                  collectedDays.push(event.day);
                  const metadata: MessageMetadata = {
                    type: 'plan_preview' as const,
                    planData: { schedule: [...collectedDays], goal: '', weeksDuration: 12, sessionsPerWeek: 4 },
                  };
                  // Update message with days in metadata
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId ? { ...msg, metadata } : msg
                  ));
                  // Save state with updated progress
                  saveStreamingState(assistantMessageId, fullText, metadata, true, event.progress || null);
                }
                if (event.progress) {
                  setStreamProgress(event.progress);
                }
                break;
                
              case 'adjustment-generated':
                if (event.adjustment) {
                  collectedAdjustments.push(event.adjustment);
                  const adjMetadata: MessageMetadata = {
                    type: 'adjustment_preview' as const,
                    adjustmentId: adjustmentId,
                    adjustmentData: {
                      summary: '',
                      exercises: [...collectedAdjustments],
                    },
                  };
                  // Update message with adjustments in metadata
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId ? { ...msg, metadata: adjMetadata } : msg
                  ));
                  // Save state for navigation persistence
                  saveStreamingState(assistantMessageId, fullText, adjMetadata, false, event.progress || null);
                }
                if (event.progress) {
                  setStreamProgress(event.progress);
                }
                break;
                
              case 'done':
                finalPlanId = event.planId || null;
                setIsGeneratingDays(false);
                // Update with final planId
                if (finalPlanId) {
                  const completePlanId = finalPlanId; // Capture for closure
                  setMessages(prev => prev.map(msg => 
                    msg.id === assistantMessageId ? { 
                      ...msg, 
                      metadata: {
                        ...msg.metadata,
                        type: 'plan_preview' as const,
                        planId: completePlanId,
                        planData: { schedule: collectedDays, goal: '', weeksDuration: 12, sessionsPerWeek: 4 },
                      }
                    } : msg
                  ));
                }
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

      // Mark streaming as done (no need to update message - it's already complete)
      setIsStreaming(false);
      setIsLoading(false);
      setIsGeneratingDays(false);
      setStreamProgress(null);
      sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
      clearStreamingState(); // Clear persisted streaming state
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
      streamingContentRef.current = '';
      
      // Skip syncing with server to prevent overwriting our complete local state
      // The server has saved the messages, they'll sync on next navigation
      skipNextSyncRef.current = true;

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled, handled by handleStopStreaming
        return;
      }
      console.error('Streaming error:', error);
      // Update message to show error
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId ? { ...msg, content: msg.content + '\n\n*[Error occurred]*' } : msg
      ));
      setIsStreaming(false);
      setIsLoading(false);
      setIsGeneratingDays(false);
      setStreamProgress(null);
      sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
      clearStreamingState(); // Clear persisted streaming state on error
      abortControllerRef.current = null;
      streamingMessageIdRef.current = null;
      streamingContentRef.current = '';
    }
  }, [data.sessionId, activePlan?.id, user?.bodyweight, user?.name, adjustmentId, isLoading, isStreaming, showHistory, router, saveStreamingState, clearStreamingState]);

  // Reset state when session changes (switching conversations)
  useEffect(() => {
    if (prevSessionIdRef.current !== data.sessionId) {
      // Session changed - reset all state
      setMessages(data.messages);
      setInput('');
      setIsLoading(false);
      setIsStreaming(false);
      setIsGeneratingDays(false);
      setStreamProgress(null);
      setSelectedAction(null);
      setShowHistory(false);
      setSwitchingSession(false); // Clear switching state after session loads
      setStartingNewChat(false); // Clear new chat transition state
      setCurrentMode(urlMode || data.detectedMode || null); // Reset mode for new session
      sessionStorage.removeItem(`chat-loading-${prevSessionIdRef.current}`);
      sessionStorage.removeItem(`chat-streaming-${prevSessionIdRef.current}`);
      streamStateRestoredRef.current = false; // Allow restore for new session
      prevSessionIdRef.current = data.sessionId;
      lastMessageCountRef.current = data.messages.length;
      return;
    }
  }, [data.sessionId, urlMode, data.detectedMode]); // Only depend on sessionId, not messages

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
        setIsStreaming(false);
        setIsGeneratingDays(false);
        setStreamProgress(null);
        sessionStorage.removeItem(`chat-loading-${data.sessionId}`);
        sessionStorage.removeItem(`chat-streaming-${data.sessionId}`);
      }
      // Otherwise, keep current messages (includes optimistic user message and loader)
      // Don't sync until we get the assistant response
    } else if (skipNextSyncRef.current) {
      // Skip this sync - we just stopped streaming and have local-only messages
      // Only clear the flag once server catches up (has same or more messages)
      if (newCount >= messages.length) {
        skipNextSyncRef.current = false;
        setMessages(data.messages);
      }
    } else {
      // Check if we have saved streaming state - don't overwrite if restoring
      const savedState = sessionStorage.getItem(`chat-streaming-${data.sessionId}`);
      if (savedState && !streamStateRestoredRef.current) {
        // We have saved state to restore, don't sync yet
        return;
      }
      // Not loading and not skipping - normal case: sync from server
      // But never clear local messages with empty server data (defensive check)
      if (newCount >= messages.length || messages.length === 0) {
        setMessages(data.messages);
      }
      // Otherwise keep local messages until server catches up
    }
    
    if (data.messages.length === 0) {
      setInput('');
    }
    
    lastMessageCountRef.current = newCount;
  }, [data.sessionId, data.messages.length, data.messages, isLoading, messages.length]);

  // Sync approved plans and adjustments from server
  useEffect(() => {
    setApprovedPlans(new Set(data.approvedPlanIds));
    setApprovedAdjustments(new Set(data.approvedAdjustmentIds));
  }, [data.approvedPlanIds, data.approvedAdjustmentIds]);

  // Focus input when action is selected
  useEffect(() => {
    if (selectedAction && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedAction]);

  // Update URL with session ID after creation
  useEffect(() => {
    if (isNewSession && data.sessionId && mode) {
      // Update URL with session parameter while preserving the mode path and adjustmentId
      const currentPath = mode ? `/chat/${mode}` : '/chat';
      const params = new URLSearchParams();
      params.set('session', data.sessionId);
      if (adjustmentId) {
        params.set('adjustmentId', adjustmentId);
      }
      router.replace(`${currentPath}?${params.toString()}`);
    }
  }, [isNewSession, data.sessionId, mode, adjustmentId, router]);

  // Auto-scroll to bottom when messages change or generating state changes (unless user scrolled up)
  useEffect(() => {
    if (!autoScrollDisabledRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isGeneratingDays, streamProgress]);

  // Detect when user scrolls up during streaming to disable auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!isStreaming) return;
      
      // Check if user is near the bottom (within 100px)
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      
      // If user scrolled away from bottom during streaming, disable auto-scroll
      if (!isNearBottom) {
        autoScrollDisabledRef.current = true;
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isStreaming]);
  
  // Get the current streaming message (if any) to determine if we should show typing indicator
  const streamingMessage = streamingMessageIdRef.current 
    ? messages.find(m => m.id === streamingMessageIdRef.current)
    : null;
  const showTypingIndicator = isStreaming && (!streamingMessage || !streamingMessage.content);

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
      setCurrentMode('create');
      initialModeSet.current = true;
    } else if (mode === 'edit' && messages.length === 0) {
      setSelectedAction('edit');
      setCurrentMode('edit');
      initialModeSet.current = true;
    } else if (mode === 'ask' && messages.length === 0) {
      setSelectedAction('ask');
      setCurrentMode('ask');
      initialModeSet.current = true;
    }
  }, [mode, messages.length]);

  // Handle post-workout mode - automatically analyze the completed workout (now uses streaming with AI message)
  useEffect(() => {
    if (mode === 'post_workout' && adjustmentId && messages.length === 0 && !isLoading && !isStreaming) {
      const postWorkoutKey = `${data.sessionId}-${adjustmentId}`;
      
      // Check if we've already processed this adjustment
      if (postWorkoutProcessedRef.current === postWorkoutKey) {
        return;
      }
      
      postWorkoutProcessedRef.current = postWorkoutKey;
      
      // Start streaming immediately without user message
      (async () => {
        try {
          // Create initial message showing "Analyzing workout..."
          const assistantMessageId = `stream-${Date.now()}`;
          streamingMessageIdRef.current = assistantMessageId;
          
          const assistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: 'Analyzing your workout...',
            metadata: null,
            createdAt: new Date().toISOString(),
          };

          setMessages([assistantMessage]);
          setIsLoading(true);
          setIsStreaming(true);
          autoScrollDisabledRef.current = false;

          // Create abort controller
          abortControllerRef.current = new AbortController();

          const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: data.sessionId,
              message: '', // Empty message - backend will generate the analysis
              mode: 'post_workout',
              planId: activePlan?.id,
              context: {
                bodyweight: user?.bodyweight,
                userName: user?.name,
                adjustmentId: adjustmentId,
              },
            }),
            signal: abortControllerRef.current?.signal,
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
                      streamingContentRef.current = fullText;
                      setMessages([{ ...assistantMessage, content: fullText }]);
                      saveStreamingState(assistantMessageId, fullText, null, false, null);
                    }
                    break;
                    
                  case 'adjustment-generated':
                    if (event.adjustment) {
                      collectedAdjustments.push(event.adjustment);
                      const adjMetadata: MessageMetadata = {
                        type: 'adjustment_preview' as const,
                        adjustmentId: adjustmentId,
                        adjustmentData: {
                          summary: '',
                          exercises: [...collectedAdjustments],
                        },
                      };
                      setMessages([{ ...assistantMessage, content: fullText, metadata: adjMetadata }]);
                      saveStreamingState(assistantMessageId, fullText, adjMetadata, false, event.progress || null);
                    }
                    if (event.progress) {
                      setStreamProgress(event.progress);
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
          setStreamProgress(null);
          clearStreamingState();
          abortControllerRef.current = null;
          streamingMessageIdRef.current = null;
          streamingContentRef.current = '';
          
          // Skip syncing with server to prevent overwriting our complete local state
          // The server has saved the messages, they'll sync on next navigation
          skipNextSyncRef.current = true;

        } catch (error) {
          console.error('Streaming error:', error);
          setIsStreaming(false);
          setIsLoading(false);
          setStreamProgress(null);
          clearStreamingState();
        }
      })();
    }
  }, [mode, adjustmentId, messages.length, isLoading, isStreaming, data.sessionId, activePlan?.id, user?.bodyweight, user?.name, router, saveStreamingState, clearStreamingState]);

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
    // If we have an adjustmentId, we're in post_workout mode
    // Map 'edit' and 'ask' modes to their backend equivalents
    let effectiveMode = mode || 'general';
    if (effectiveMode === 'edit') effectiveMode = 'create';
    if (effectiveMode === 'ask') effectiveMode = 'general';
    if (adjustmentId) effectiveMode = 'post_workout';
    await handleStreamingSend(input.trim(), effectiveMode);
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
    return undefined;
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
  const handleApprove = async (messageId: string, action: 'activate' | 'replace' = 'activate') => {
    // Prevent double-clicks
    if (approvingPlan === `${messageId}-${action}`) return;
    
    setApprovingPlan(`${messageId}-${action}`);
    
    try {
      console.log(`[handleApprove] Starting with messageId: ${messageId}, action: ${action}`);
      
      // Get the message to see what we're sending
      const message = messages.find(m => m.id === messageId);
      if (message?.metadata) {
        const metadata = message.metadata as { planData?: any };
        if (metadata.planData) {
          console.log(`[handleApprove] Plan data structure:`, {
            goal: metadata.planData.goal,
            weeksDuration: metadata.planData.weeksDuration,
            sessionsPerWeek: metadata.planData.sessionsPerWeek,
            scheduleDays: metadata.planData.schedule?.length,
            schedulePreview: metadata.planData.schedule?.map((d: any) => ({
              dayNumber: d.dayNumber,
              dayName: d.dayName,
              workoutType: d.workoutType,
              exerciseCount: d.exercises?.length
            }))
          });
        }
      }
      
      const response = await fetch('/api/plan/apply-from-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, action }),
      });

      console.log(`[handleApprove] Response status: ${response.status}`);
      const result = await response.json();
      console.log(`[handleApprove] Response result:`, result);
      
      if (!result.success) {
        console.error('Plan approval failed:', result.error);
        alert(`Failed to ${action} plan: ${result.error || 'Unknown error'}`);
        return;
      }

      console.log(`Plan ${action} successful:`, result);

      // Mark the message as approved in the database
      await fetch('/api/chat/approve-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });

      // Mark plan as approved in UI (for immediate feedback)
      setApprovedPlans((prev) => new Set(prev).add(messageId));
      router.refresh();
    } catch (error) {
      console.error('Approval error:', error);
      alert(`Failed to ${action} plan. Please try again.`);
    } finally {
      setApprovingPlan(null);
    }
  };

  // Handle plan approval loading state
  const [approvingPlan, setApprovingPlan] = useState<string | null>(null);
  
  // Handle adjustment approval
  const [approvingAdjustment, setApprovingAdjustment] = useState<string | null>(null);

  const handleApproveAdjustments = async (adjId: string, messageId: string) => {
    // Prevent double-clicks
    if (approvingAdjustment === adjId) return;
    
    setApprovingAdjustment(adjId);
    
    try {
      // First, mark this message as approved (and unmark others)
      const approveResponse = await fetch('/api/chat/approve-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, adjustmentId: adjId }),
      });

      const approveResult = await approveResponse.json();
      if (!approveResult.success) {
        throw new Error(approveResult.error || 'Failed to mark message as approved');
      }

      // Then apply the adjustments to the workout
      const response = await fetch('/api/workout/apply-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustmentId: adjId }),
      });

      const result = await response.json();

      if (result.success) {
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

  // Show new chat menu
  const handleNewChat = () => {
    setShowNewChatMenu(true);
    setShowHistory(false);
  };
  
  // Actually create a new chat when user selects an action
  const handleSelectNewChatAction = (action: 'create' | 'addCurrent' | 'edit' | 'ask') => {
    // Set transition state to hide old content while navigating
    setStartingNewChat(true);
    setMessages([]);
    setShowNewChatMenu(false);
    // Navigate to new chat with the selected mode
    const modePath = action === 'addCurrent' ? 'create' : action;
    router.push(`/chat/${modePath}?new=true`);
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
    setSwitchingSession(true);
    // Determine the path based on current mode
    const basePath = mode && mode !== 'general' ? `/chat/${mode}` : '/chat';
    router.push(`${basePath}?session=${sessionIdToOpen}`);
  };

  return (
    <div className="fixed inset-0 flex flex-col">
      {/* Loading overlay when switching sessions */}
      {switchingSession && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 pb-16">
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-1">
              <span className="w-3 h-3 bg-primary rounded-full animate-pulse" />
              <span className="w-3 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-3 h-3 bg-primary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="text-muted-foreground">Loading chat...</p>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-foreground">ESP Fitness Planner</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'create'
                ? 'Creating a new plan'
                : mode === 'edit'
                ? 'Editing your plan'
                : mode === 'submit'
                ? 'Logging workout'
                : mode === 'post_workout'
                ? 'Workout Analysis'
                : mode === 'ask'
                ? 'Ask me anything'
                : 'Ask me anything'}
            </p>
          </div>
          <div className="flex gap-2">
            {!showHistory && !showNewChatMenu && (
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
            {(messages.length > 0 || showHistory || showNewChatMenu || selectedAction || mode) && (
              <button
                onClick={() => {
                  if (showHistory) {
                    setShowHistory(false);
                  } else if (showNewChatMenu) {
                    setShowNewChatMenu(false);
                  } else if ((selectedAction || mode) && messages.length === 0) {
                    setSelectedAction(null);
                    setCurrentMode(null);
                    // Clear URL completely when going back to menu
                    window.history.replaceState({}, '', '/chat');
                  } else {
                    handleNewChat();
                  }
                }}
                className="p-2 rounded-lg hover:bg-surface transition-colors"
                title={showHistory ? "Back to chat" : showNewChatMenu ? "Back to chat" : ((selectedAction || mode) && messages.length === 0) ? "Back to menu" : "New chat"}
              >
                {showHistory || showNewChatMenu ? (
                  <X size={18} className="text-muted-foreground" />
                ) : (
                  <Plus size={18} className="text-muted-foreground" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* New Chat Menu */}
      {showNewChatMenu && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
          <p className="text-center text-muted-foreground mb-6">
            What would you like to do?
          </p>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <button
              onClick={() => handleSelectNewChatAction('create')}
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
              onClick={() => handleSelectNewChatAction('addCurrent')}
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
                onClick={() => handleSelectNewChatAction('edit')}
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
              onClick={() => handleSelectNewChatAction('ask')}
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

      {/* History View */}
      {showHistory && !showNewChatMenu && (
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

      {/* Quick Actions - only shown when NO mode from URL */}
      {!showHistory && !showNewChatMenu && !startingNewChat && messages.length === 0 && !isLoading && !selectedAction && !mode && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
          <p className="text-center text-muted-foreground mb-6">
            What would you like to do?
          </p>
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <button
              onClick={() => {
                setSelectedAction('create');
                setCurrentMode('create');
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
                setCurrentMode('create');
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
                  setCurrentMode('edit');
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
                setCurrentMode('ask');
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

      {/* Action Card - shown when an action is selected OR mode is set from URL */}
      {!showHistory && !showNewChatMenu && !startingNewChat && messages.length === 0 && !isLoading && (selectedAction || mode) && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-32">
          <div className="w-full max-w-md bg-surface rounded-xl p-6 space-y-3">
            {(selectedAction === 'create' || mode === 'create') && (
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

            {(selectedAction === 'edit' || mode === 'edit') && (
              <>
                <h2 className="text-lg font-semibold text-foreground">Edit Existing Plan</h2>
                <p className="text-sm text-muted-foreground">What would you like to change about your current workout plan?</p>
                <p className="text-xs text-muted-foreground opacity-70">Example: I want to add more leg exercises, reduce session count to 3 days, switch bench press to dumbbells...</p>
              </>
            )}

            {(selectedAction === 'ask' || mode === 'ask') && (
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
      {!showHistory && !showNewChatMenu && !startingNewChat && (messages.length > 0 || isLoading) && (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto pb-32">
          <div className="px-4 py-4 space-y-3">
          {messages.map((message) => {
            // Skip empty assistant messages (streaming placeholders before content arrives)
            if (message.role === 'assistant' && !message.content && !message.metadata) {
              return null;
            }
            
            return (
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
                      // Always strip JSON blocks from assistant messages - they're never shown as raw text
                      const displayContent = message.content
                        .replace(/```(?:json)?\s*[\s\S]*?```/g, '')
                        .trim();
                      
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

                {/* Plan Preview - show days as they're generated */}
                {(message.metadata?.type === 'plan_preview' && message.metadata?.planData) || 
                 (message.id === streamingMessageIdRef.current && isGeneratingDays) ? (
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    {(() => {
                      const plan = message.metadata?.planData as any;
                      const hasDays = plan?.schedule?.length > 0;
                      // Calculate actual sessions per week from schedule
                      const sessionsPerWeek = plan?.schedule?.filter((day: any) => day.workoutType !== 'rest')?.length || 3;
                      
                      return (
                        <>
                          {hasDays && (
                            <div className="text-xs text-muted-foreground">
                              {plan.weeksDuration || 12} weeks • {sessionsPerWeek} sessions/week
                            </div>
                          )}
                          {plan?.schedule?.map((day: any, idx: number) => (
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
                              <div className="space-y-2">
                                {day.exercises?.map((ex: any, exIdx: number) => {
                                  const formatExercise = () => {
                                    const type = ex.exerciseType || 'strength';
                                    const formatWeight = () => {
                                      if (ex.weightType === '1RM') return `${Math.round(ex.weightValue * 100)}% 1RM`;
                                      if (ex.weightType === 'BW') return `${Math.round(ex.weightValue * 100)}% BW`;
                                      if (ex.weightType === 'RPE') return `RPE ${ex.weightValue}`;
                                      if (ex.weightValue === 0) return '';
                                      return `${ex.weightValue} lbs`;
                                    };
                                    
                                    // Format sets with range support
                                    const formatSets = () => ex.setsMin ? `${ex.setsMin}-${ex.sets}` : `${ex.sets}`;
                                    // Format reps with range support
                                    const formatReps = () => ex.repsMin ? `${ex.repsMin}-${ex.reps}` : `${ex.reps}`;
                                    
                                    switch (type) {
                                      case 'cardio_time':
                                      case 'mobility_time':
                                        // Use duration field if available, fall back to reps for backwards compatibility
                                        const mins = ex.duration || ex.reps;
                                        return `${mins} min`;
                                      case 'distance':
                                        const weight = ex.weightValue > 0 ? ` @ ${formatWeight()}` : '';
                                        return `${formatSets()} × ${ex.distance} ${ex.distanceUnit || 'feet'}${weight}`;
                                      case 'interval':
                                        if (ex.intervals) {
                                          const { rounds, phases } = ex.intervals;
                                          const intervalWeight = ex.weightValue > 0 ? ` @ ${formatWeight()}` : '';
                                          if (phases?.length === 2) {
                                            return `${rounds} rounds: ${Math.floor(phases[0].duration / 60)}min ${phases[0].name} / ${Math.floor(phases[1].duration / 60)}min ${phases[1].name}${intervalWeight}`;
                                          }
                                          return `${rounds} rounds interval${intervalWeight}`;
                                        }
                                        return 'Interval';
                                      case 'amrap':
                                        const amrapWeight = ex.weightValue > 0 ? ` @ ${formatWeight()}` : '';
                                        return `AMRAP ${Math.floor((ex.timeCap || 600) / 60)} min • ${formatReps()} reps/round${amrapWeight}`;
                                      case 'emom':
                                        const emomWeight = ex.weightValue > 0 ? ` @ ${formatWeight()}` : '';
                                        return `EMOM ${Math.floor((ex.timeCap || 600) / 60)} min • ${formatReps()} reps/min${emomWeight}`;
                                      case 'tabata':
                                        const tabataWeight = ex.weightValue > 0 ? ` @ ${formatWeight()}` : '';
                                        return `Tabata ${formatSets()} rounds • ${formatReps()} reps/round${tabataWeight}`;
                                      case 'tempo':
                                        return `${formatSets()}×${formatReps()} @ tempo ${ex.tempo || '3-1-3-1'}`;
                                      default:
                                        return `${formatSets()}×${formatReps()} @ ${formatWeight()}`;
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
                          
                          {/* Generating indicator - shows at the bottom while creating days */}
                          {message.id === streamingMessageIdRef.current && isGeneratingDays && (
                            <div className="flex items-center gap-3 py-2">
                              <div className="flex gap-1">
                                <span className="w-2 h-2 bg-primary rounded-full animate-typing" />
                                <span className="w-2 h-2 bg-primary rounded-full animate-typing" style={{ animationDelay: '0.2s' }} />
                                <span className="w-2 h-2 bg-primary rounded-full animate-typing" style={{ animationDelay: '0.4s' }} />
                              </div>
                              <span className="text-sm text-muted-foreground">
                                {streamProgress ? `Generating ${streamProgress.label}...` : 'Generating workout plan...'}
                              </span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : null}

                {/* Approval buttons or approved status if this is a plan preview */}
                {message.metadata?.type === 'plan_preview' && message.metadata?.planData && (
                  <div className="mt-4 pt-4 border-t border-border">
                    {(() => {
                      const messageMetadata = message.metadata as { approved?: boolean };
                      const isApproved = messageMetadata.approved === true;
                      
                      // Check if this message is still being generated
                      const isCurrentlyGenerating = message.id === streamingMessageIdRef.current && isGeneratingDays;
                      
                      // If approved, show success message
                      if (isApproved) {
                        return (
                          <div className="text-center text-success font-medium py-2">
                            ✓ Plan Applied Successfully
                          </div>
                        );
                      }
                      
                      // If still generating, don't show buttons yet
                      if (isCurrentlyGenerating) {
                        return null; // Buttons will appear after generation is complete
                      }
                      
                      // Show approval buttons for any plan (user can revert to older versions)
                      const isApprovingReplace = approvingPlan === `${message.id}-replace`;
                      const isApprovingActivate = approvingPlan === `${message.id}-activate`;
                      const isApproving = isApprovingReplace || isApprovingActivate;
                      
                      return (
                        <div className="flex gap-2">
                          {activePlan ? (
                            <>
                              <button
                                onClick={() => handleApprove(message.id, 'replace')}
                                disabled={isApproving}
                                className="flex-1 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-lg
                                         hover:bg-primary/90 active:bg-primary/80 transition-colors
                                         disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              >
                                {isApprovingReplace && <LoadingSpinner size="sm" />}
                                Replace Current
                              </button>
                              <button
                                onClick={() => handleApprove(message.id, 'activate')}
                                disabled={isApproving}
                                className="flex-1 px-4 py-2.5 bg-surface-elevated text-foreground text-sm font-medium rounded-lg
                                         hover:bg-white/10 active:bg-white/5 transition-colors border border-border
                                         disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              >
                                {isApprovingActivate && <LoadingSpinner size="sm" />}
                                Save as New
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleApprove(message.id, 'activate')}
                              disabled={isApproving}
                              className="flex-1 px-4 py-2.5 bg-primary text-white text-sm font-medium rounded-lg
                                       hover:bg-primary/90 active:bg-primary/80 transition-colors
                                       disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {isApprovingActivate && <LoadingSpinner size="sm" />}
                              Activate Plan
                            </button>
                          )}
                          <button
                            onClick={() => setInput("I'd like to make some changes...")}
                            disabled={isApproving}
                            className="flex-1 px-4 py-2.5 bg-transparent text-muted-foreground text-sm font-medium rounded-lg
                                     hover:bg-white/5 hover:text-foreground active:bg-white/10 transition-colors border border-border/50
                                     disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Request Changes
                          </button>
                        </div>
                      );
                    })()}
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
                          {adjustment.exercises?.map((ex: any, idx: number) => {
                            // Format weight display based on type
                            const formatWeight = (weight: number, weightType: string) => {
                              if (weightType === 'BW') {
                                return `${Math.round(weight * 100)}% BW`;
                              } else if (weightType === '1RM') {
                                return `${Math.round(weight * 100)}% 1RM`;
                              } else {
                                return `${weight} lbs`;
                              }
                            };
                            
                            const currentWeightDisplay = formatWeight(
                              ex.currentWeight, 
                              ex.currentWeightType || 'ABSOLUTE'
                            );
                            const nextWeightDisplay = formatWeight(
                              ex.nextWeight, 
                              ex.nextWeightType || 'ABSOLUTE'
                            );
                            
                            // Check if performed data exists
                            const hasPerformed = ex.performedSets !== undefined;
                            
                            // Format display based on exercise type
                            const formatPrescribed = () => {
                              if (ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time') {
                                return `${ex.currentDuration || ex.currentReps} minutes`;
                              } else if (ex.exerciseType === 'distance') {
                                const weightDisplay = ex.currentWeight > 0 ? ` @ ${currentWeightDisplay}` : '';
                                return `${ex.currentSets} sets × ${ex.currentDistance || 0} ${ex.currentDistanceUnit || 'feet'}${weightDisplay}`;
                              } else if (ex.exerciseType === 'interval') {
                                if (ex.currentIntervals) {
                                  const intervals = ex.currentIntervals as any;
                                  const { rounds, phases } = intervals;
                                  const weightDisplay = ex.currentWeight > 0 ? ` @ ${currentWeightDisplay}` : '';
                                  if (phases && phases.length === 2) {
                                    return `${rounds} rounds: ${Math.floor(phases[0].duration / 60)}:${String(phases[0].duration % 60).padStart(2, '0')} ${phases[0].name} / ${Math.floor(phases[1].duration / 60)}:${String(phases[1].duration % 60).padStart(2, '0')} ${phases[1].name}${weightDisplay}`;
                                  }
                                  return `${rounds} rounds interval${weightDisplay}`;
                                }
                                return 'Interval training';
                              } else if (ex.exerciseType === 'emom') {
                                const mins = Math.floor((ex.currentTimeCap || 600) / 60);
                                const weightDisplay = ex.currentWeight > 0 ? ` @ ${currentWeightDisplay}` : '';
                                return `EMOM ${mins} min: ${ex.currentReps} reps/min${weightDisplay}`;
                              } else if (ex.exerciseType === 'amrap') {
                                const mins = Math.floor((ex.currentTimeCap || 600) / 60);
                                const weightDisplay = ex.currentWeight > 0 ? ` @ ${currentWeightDisplay}` : '';
                                return `AMRAP ${mins} min: ${ex.currentReps} reps/round${weightDisplay}`;
                              } else if (ex.exerciseType === 'tabata') {
                                const weightDisplay = ex.currentWeight > 0 ? ` @ ${currentWeightDisplay}` : '';
                                return `Tabata ${ex.currentSets} rounds: ${ex.currentReps} reps/round${weightDisplay}`;
                              } else {
                                return `${ex.currentSets}×${ex.currentReps} @ ${currentWeightDisplay}`;
                              }
                            };
                            
                            const formatPerformed = () => {
                              if (ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time') {
                                const mins = ex.performedDuration ? Math.round(ex.performedDuration / 60) : (ex.performedRepsDetail?.[0] || ex.currentDuration || ex.currentReps);
                                return `${mins} minutes`;
                              } else if (ex.exerciseType === 'distance') {
                                if (ex.performedWeightsDetail && ex.performedWeightsDetail.length > 0) {
                                  return (
                                    <span className="text-xs">
                                      {ex.performedWeightsDetail.map((weight: number, idx: number) => (
                                        <span key={idx} className="mr-2">
                                          Set {idx + 1}: {ex.performedDistance || ex.currentDistance || 0} {ex.currentDistanceUnit || 'feet'} @ {weight}lbs
                                        </span>
                                      ))}
                                    </span>
                                  );
                                }
                                return `${ex.performedSets} sets`;
                              } else {
                                // Strength exercise
                                if (ex.performedWeightsDetail && ex.performedWeightsDetail.length > 0) {
                                  return (
                                    <span className="text-xs">
                                      {ex.performedWeightsDetail.map((weight: number, idx: number) => (
                                        <span key={idx} className="mr-2">
                                          Set {idx + 1}: {ex.performedRepsDetail?.[idx] || 0}×{weight}lbs
                                        </span>
                                      ))}
                                    </span>
                                  );
                                }
                                return `${ex.performedSets} sets @ ${ex.performedWeight} lbs`;
                              }
                            };
                            
                            const formatNext = () => {
                              if (ex.exerciseType === 'cardio_time' || ex.exerciseType === 'mobility_time') {
                                return `${ex.nextDuration || ex.nextReps} minutes`;
                              } else if (ex.exerciseType === 'distance') {
                                const weightDisplay = ex.nextWeight > 0 ? ` @ ${nextWeightDisplay}` : '';
                                return `${ex.nextSets} sets × ${ex.nextDistance || 0} ${ex.currentDistanceUnit || 'feet'}${weightDisplay}`;
                              } else if (ex.exerciseType === 'interval') {
                                if (ex.nextIntervals) {
                                  const intervals = ex.nextIntervals as any;
                                  const { rounds, phases } = intervals;
                                  const weightDisplay = ex.nextWeight > 0 ? ` @ ${nextWeightDisplay}` : '';
                                  if (phases && phases.length === 2) {
                                    return `${rounds} rounds: ${Math.floor(phases[0].duration / 60)}:${String(phases[0].duration % 60).padStart(2, '0')} ${phases[0].name} / ${Math.floor(phases[1].duration / 60)}:${String(phases[1].duration % 60).padStart(2, '0')} ${phases[1].name}${weightDisplay}`;
                                  }
                                  return `${rounds} rounds interval${weightDisplay}`;
                                }
                                return 'Interval training';
                              } else if (ex.exerciseType === 'emom') {
                                const mins = Math.floor((ex.nextTimeCap || ex.currentTimeCap || 600) / 60);
                                const weightDisplay = ex.nextWeight > 0 ? ` @ ${nextWeightDisplay}` : '';
                                return `EMOM ${mins} min: ${ex.nextReps} reps/min${weightDisplay}`;
                              } else if (ex.exerciseType === 'amrap') {
                                const mins = Math.floor((ex.nextTimeCap || ex.currentTimeCap || 600) / 60);
                                const weightDisplay = ex.nextWeight > 0 ? ` @ ${nextWeightDisplay}` : '';
                                return `AMRAP ${mins} min: ${ex.nextReps} reps/round${weightDisplay}`;
                              } else if (ex.exerciseType === 'tabata') {
                                const weightDisplay = ex.nextWeight > 0 ? ` @ ${nextWeightDisplay}` : '';
                                return `Tabata ${ex.nextSets} rounds: ${ex.nextReps} reps/round${weightDisplay}`;
                              } else {
                                return `${ex.nextSets}×${ex.nextReps} @ ${nextWeightDisplay}`;
                              }
                            };
                            
                            return (
                              <div key={idx} className="bg-background/30 rounded-lg p-3">
                                <p className="font-semibold text-sm mb-2">{ex.name}</p>
                                
                                {/* Show all three: prescribed, performed, next */}
                                <div className="space-y-1 text-xs mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground w-20">Prescribed:</span>
                                    <span className="text-foreground">
                                      {formatPrescribed()}
                                    </span>
                                  </div>
                                  {hasPerformed && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-muted-foreground w-20">Performed:</span>
                                      <span className="text-foreground">
                                        {formatPerformed()}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <span className="text-success w-20">Next:</span>
                                    <span className="font-medium text-success">
                                      {formatNext()}
                                    </span>
                                  </div>
                                </div>
                                
                                <p className="text-xs text-muted-foreground">{ex.reasoning}</p>
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Adjustment approval buttons */}
                {message.metadata?.type === 'adjustment_preview' && message.metadata?.adjustmentId && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {(() => {
                      const adjId = message.metadata.adjustmentId as string;
                      const messageMetadata = message.metadata as { approved?: boolean };
                      // Check this message's approval status
                      const isApproved = messageMetadata.approved === true;
                      const isApproving = approvingAdjustment === adjId;
                      
                      return isApproved ? (
                        <div className="text-center text-success font-medium">
                          ✓ Applied to next workout
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button
                            onClick={() => handleApproveAdjustments(adjId, message.id)}
                            disabled={isApproving}
                            className="w-full px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg
                                     hover:bg-primary/90 active:bg-primary/80 transition-colors
                                     disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {isApproving && <LoadingSpinner size="sm" />}
                            {isApproving ? 'Applying...' : 'Approve All'}
                          </button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setInput("I'd like to adjust...")}
                            fullWidth
                            disabled={isApproving}
                          >
                            Modify Suggestions
                          </Button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          );
          })}

          {/* Typing indicator - only show when loading but no streaming text yet */}
          {showTypingIndicator && (
            <div className="flex justify-start">
              <div className="bg-surface rounded-2xl px-4 py-2.5">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-typing" />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-typing" style={{ animationDelay: '0.2s' }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-typing" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            </div>
          )}

          {/* Progress indicator - show when generating days */}
          {streamProgress && (
            <div className="flex justify-start">
              <div className="bg-surface/50 rounded-xl px-3 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {streamProgress.label} ({streamProgress.current}/{streamProgress.total})
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
      )}

      {/* Input - Fixed at bottom above nav */}
      {!showHistory && !showNewChatMenu && !startingNewChat && (messages.length > 0 || isLoading || selectedAction || mode) && (
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
                (selectedAction === 'create' || mode === 'create') ? "Describe your fitness goals..." :
                (selectedAction === 'edit' || mode === 'edit') ? "What would you like to change..." :
                (selectedAction === 'ask' || mode === 'ask') ? "Ask a question..." :
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
                onClick={selectedAction ? handleActionSend : handleSend}
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
