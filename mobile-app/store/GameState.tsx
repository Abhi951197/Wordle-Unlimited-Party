import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { trackEvent } from '@/utils/analytics';

interface Stats {
  gamesPlayed: number;
  wins: number;
  hintGames: number;
  hintWins: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: number[];
  byDifficulty: Record<string, DifficultyStats>;
}

export interface DifficultyStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  hintGames: number;
  hintWins: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: number[];
}

export interface Toast {
  message: string;
  type: 'error' | 'warning' | 'info';
}

export interface LiveKitSession {
  configured: boolean;
  url?: string | null;
  token?: string | null;
}

export interface RoomPlayer {
  player_id: string;
  player_name: string;
  player_emoji?: string;
  joined_at: string;
  last_active_at?: string | null;
}

export interface BoardState {
  session_id: string;
  difficulty: string;
  daily_date?: string | null;
  length: number;
  guesses: string[];
  results: string[][];
  current_guess: string;
  input_version?: number;
  game_over: boolean;
  won: boolean;
  answer?: string | null;
  answer_info?: AnswerInfo | null;
  hints_used?: number;
  hints?: HintState[];
  typing_player_id?: string | null;
  typing_player_name?: string | null;
  typing_player_emoji?: string | null;
}

export interface HintState {
  level: number;
  text: string;
  kind?: 'meaning' | 'letter' | 'structure';
  revealed_position?: number | null;
  revealed_letter?: string | null;
}

export interface AnswerInfo {
  word: string;
  definition: string;
  part_of_speech: string;
  category_hint: string;
  riddle_hint: string;
  structure_hint: string;
  example: string;
}

export interface ShareRequestState {
  from_player_id: string;
  from_player_name: string;
  session_id: string;
  created_at: string;
}

export interface ChatMessage {
  message_id: string;
  player_id: string;
  player_name: string;
  player_emoji: string;
  text: string;
  created_at: string;
}

export type ActiveBoard = 'shared' | 'individual';

export interface LeaderboardProfile {
  user_id: string;
  username: string;
  emoji: string;
  leaderboard_token: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  emoji: string;
  score: number;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  current_streak: number;
  max_streak: number;
  avg_guesses?: number | null;
  hint_games: number;
  hint_wins: number;
  total_guesses?: number;
  guess_distribution?: number[];
  badges?: AchievementProgress[];
}

export interface LeaderboardResponse {
  scope: string;
  period?: 'weekly' | 'all_time';
  period_key?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  resets_at?: string | null;
  entries: LeaderboardEntry[];
  current_user?: LeaderboardEntry | null;
  scoring: Record<string, unknown>;
}

export interface PublicStatsScope {
  scope: string;
  score: number;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  current_streak: number;
  max_streak: number;
  total_guesses: number;
  avg_guesses?: number | null;
  hint_games: number;
  hint_wins: number;
  guess_distribution: number[];
}

export interface AchievementProgress {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  current: number;
  unlocked: boolean;
  unlocked_at?: string | null;
  period_key?: string | null;
}

export interface PublicProfile {
  player: { user_id: string; username: string; emoji: string; created_at: string };
  period: { period_key: string; period_start: string; period_end: string; resets_at: string };
  ranks: { weekly?: number | null; all_time?: number | null };
  all_time: Record<string, PublicStatsScope>;
  weekly: Record<string, PublicStatsScope>;
  achievements: AchievementProgress[];
}

interface GameStateContextType {
  difficulty: string;
  wordLength: number;
  sessionId: string | null;
  roomId: string | null;
  playerId: string | null;
  playerName: string;
  playerEmoji: string;
  leaderboardProfile: LeaderboardProfile | null;
  roomPlayers: RoomPlayer[];
  maxRoomPlayers: number;
  typingPlayerName: string | null;
  typingPlayerEmoji: string | null;
  livekit: LiveKitSession | null;
  activeBoard: ActiveBoard;
  sharedBoard: BoardState | null;
  individualBoard: BoardState | null;
  shareRequest: ShareRequestState | null;
  chatMessages: ChatMessage[];
  guesses: string[];
  results: string[][];
  currentGuess: string;
  gameStatus: 'playing' | 'won' | 'lost';
  letterStates: Record<string, 'correct' | 'present' | 'absent' | 'empty' | 'banned'>;
  stats: Stats;
  dailyDate: string | null;
  dailyStreak: number;
  startGame: (difficulty: string) => Promise<void>;
  startDailyGame: () => Promise<void>;
  createRoom: (difficulty: string, playerName: string, playerEmoji?: string) => Promise<boolean>;
  joinRoom: (roomId: string, playerName: string, playerEmoji?: string) => Promise<boolean>;
  registerLeaderboardProfile: (username: string, emoji?: string) => Promise<boolean>;
  checkUsername: (username: string) => Promise<{ available: boolean; valid: boolean; message?: string | null }>;
  fetchLeaderboard: (scope?: string, period?: 'weekly' | 'all_time') => Promise<LeaderboardResponse | null>;
  fetchPublicProfile: (userId: string) => Promise<PublicProfile | null>;
  leaveRoom: (options?: { forgetIdentity?: boolean }) => void;
  createSharedGame: () => Promise<void>;
  createIndividualGame: () => Promise<void>;
  changeRoomDifficulty: (difficulty: string) => Promise<void>;
  setActiveBoard: (board: ActiveBoard) => Promise<void>;
  requestShareBoard: () => Promise<void>;
  respondToShareRequest: (accept: boolean) => Promise<void>;
  sendChatMessage: (text: string) => Promise<boolean>;
  addLetter: (letter: string) => void;
  removeLetter: () => void;
  submitGuess: () => Promise<void>;
  getHint: (level: number) => Promise<void>;
  hints: HintState[];
  hintsUsed: number;
  invalidShake: number;
  lastSubmittedRow: number;
  answer: string | null;
  answerInfo: AnswerInfo | null;
  maxGuesses: number;
  toast: Toast | null;
}

const defaultStats: Stats = {
  gamesPlayed: 0,
  wins: 0,
  hintGames: 0,
  hintWins: 0,
  currentStreak: 0,
  maxStreak: 0,
  guessDistribution: [0, 0, 0, 0, 0, 0],
  byDifficulty: {},
};

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8000';
const STATS_STORAGE_KEY = 'word_unlimited_stats';
const WEEKLY_STATS_STORAGE_KEY = 'word_weekly_stats';
const DAILY_STORAGE_KEY = 'word_daily_progress';
const STATS_IMPORT_PREFIX = 'word_stats_imported_';
const ROOM_STORAGE_KEY = 'word_party_room';
const LEADERBOARD_PROFILE_KEY = 'word_leaderboard_profile';

const GameStateContext = createContext<GameStateContextType | undefined>(undefined);

export const GameStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [difficulty, setDifficulty] = useState('easy');
  const [wordLength, setWordLength] = useState(5);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('Player');
  const [leaderboardProfile, setLeaderboardProfile] = useState<LeaderboardProfile | null>(null);
  const [playerEmoji, setPlayerEmoji] = useState('🙂');
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [maxRoomPlayers, setMaxRoomPlayers] = useState(8);
  const [typingPlayerName, setTypingPlayerName] = useState<string | null>(null);
  const [typingPlayerEmoji, setTypingPlayerEmoji] = useState<string | null>(null);
  const [livekit, setLivekit] = useState<LiveKitSession | null>(null);
  const [activeBoard, setActiveBoardState] = useState<ActiveBoard>('shared');
  const [sharedBoard, setSharedBoard] = useState<BoardState | null>(null);
  const [individualBoard, setIndividualBoard] = useState<BoardState | null>(null);
  const [shareRequest, setShareRequest] = useState<ShareRequestState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [results, setResults] = useState<string[][]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameStatus, setGameStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [letterStates, setLetterStates] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [dailyDate, setDailyDate] = useState<string | null>(null);
  const [dailyStreak, setDailyStreak] = useState(0);
  const [hints, setHints] = useState<HintState[]>([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [invalidShake, setInvalidShake] = useState(0);
  const [lastSubmittedRow, setLastSubmittedRow] = useState(-1);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerInfo, setAnswerInfo] = useState<AnswerInfo | null>(null);
  const [toast, setToastState] = useState<Toast | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRoomRef = useRef<{ roomId: string | null; playerId: string | null }>({
    roomId: null,
    playerId: null,
  });
  const currentGuessRef = useRef('');
  const sessionIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const inputSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputSyncSeq = useRef(0);
  const lastLocalInputAt = useRef(0);
  const localInputVersion = useRef(0);
  const lastGuessCountRef = useRef(0);
  const localDraftActiveRef = useRef(false);
  const locallyRecordedSessionsRef = useRef<Set<string>>(new Set());
  const pendingSubmitRecoveryRef = useRef<{ guess: string; createdAt: number } | null>(null);

  useEffect(() => {
    latestRoomRef.current = { roomId, playerId };
  }, [roomId, playerId]);

  useEffect(() => {
    currentGuessRef.current = currentGuess;
  }, [currentGuess]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const retry = async () => {
      const pending = pendingSubmitRecoveryRef.current;
      if (!pending) return;
      if (Date.now() - pending.createdAt > 120000) {
        pendingSubmitRecoveryRef.current = null;
        return;
      }
      const recovered = await recoverSubmittedGuess(pending.guess);
      if (recovered) {
        pendingSubmitRecoveryRef.current = null;
      }
    };
    window.addEventListener('online', retry);
    const timer = setInterval(retry, 2500);
    return () => {
      window.removeEventListener('online', retry);
      clearInterval(timer);
    };
  }, [roomId, playerId]);

  useEffect(() => {
    AsyncStorage.getItem(STATS_STORAGE_KEY).then(val => {
      if (val) setStats(normalizeStats(JSON.parse(val)));
    });
    AsyncStorage.getItem(DAILY_STORAGE_KEY).then(val => {
      if (!val) return;
      try {
        const saved = JSON.parse(val);
        setDailyStreak(saved?.streak ?? 0);
      } catch {
        AsyncStorage.removeItem(DAILY_STORAGE_KEY);
      }
    });
    AsyncStorage.getItem(LEADERBOARD_PROFILE_KEY).then(val => {
      if (!val) return;
      try {
        const saved = JSON.parse(val);
        if (saved?.user_id && saved?.username && saved?.leaderboard_token) {
          setLeaderboardProfile(saved);
          setPlayerName(saved.username);
          setPlayerEmoji(saved.emoji || '🙂');
          void syncLocalStatsToLeaderboard(saved);
        }
      } catch {
        AsyncStorage.removeItem(LEADERBOARD_PROFILE_KEY);
      }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(ROOM_STORAGE_KEY).then(async val => {
      if (!val) return;
      try {
        const saved = JSON.parse(val);
        if (!saved.roomId || !saved.playerId) return;

        const res = await fetch(`${API_URL}/rooms/${saved.roomId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: saved.playerId,
            player_name: saved.playerName || 'Player',
            player_emoji: saved.playerEmoji || '🙂',
          }),
        });
        if (!res.ok) {
          await AsyncStorage.removeItem(ROOM_STORAGE_KEY);
          return;
        }

        const data = await res.json();
        setPlayerId(data.player_id);
        setPlayerName(saved.playerName || 'Player');
        setPlayerEmoji(saved.playerEmoji || '🙂');
        applyRoomState(data, data.player_id);
      } catch {
        await AsyncStorage.removeItem(ROOM_STORAGE_KEY);
      }
    });
  }, []);

  const emptyDifficultyStats = (): DifficultyStats => ({
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    hintGames: 0,
    hintWins: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: [0, 0, 0, 0, 0, 0],
  });

  const normalizeStats = (raw: any): Stats => ({
    gamesPlayed: raw?.gamesPlayed ?? 0,
    wins: raw?.wins ?? 0,
    hintGames: raw?.hintGames ?? 0,
    hintWins: raw?.hintWins ?? 0,
    currentStreak: raw?.currentStreak ?? 0,
    maxStreak: raw?.maxStreak ?? 0,
    guessDistribution: Array.isArray(raw?.guessDistribution) ? raw.guessDistribution.slice(0, 6).concat([0, 0, 0, 0, 0, 0]).slice(0, 6) : [0, 0, 0, 0, 0, 0],
    byDifficulty: raw?.byDifficulty ?? {},
  });

  const statsScopeToDifficultyStats = (scope?: PublicStatsScope | null): DifficultyStats => ({
    ...emptyDifficultyStats(),
    gamesPlayed: scope?.games_played ?? 0,
    wins: scope?.wins ?? 0,
    losses: scope?.losses ?? 0,
    hintGames: scope?.hint_games ?? 0,
    hintWins: scope?.hint_wins ?? 0,
    currentStreak: scope?.current_streak ?? 0,
    maxStreak: scope?.max_streak ?? 0,
    guessDistribution: Array.isArray(scope?.guess_distribution) ? scope.guess_distribution.slice(0, 6).concat([0, 0, 0, 0, 0, 0]).slice(0, 6) : [0, 0, 0, 0, 0, 0],
  });

  const publicProfileToStats = (profile: PublicProfile): Stats => {
    const overall = profile.all_time?.overall;
    const byDifficulty = ['easy', 'moderate', 'difficult', 'prodigy'].reduce<Record<string, DifficultyStats>>((acc, key) => {
      acc[key] = statsScopeToDifficultyStats(profile.all_time?.[key]);
      return acc;
    }, {});

    return normalizeStats({
      gamesPlayed: overall?.games_played ?? 0,
      wins: overall?.wins ?? 0,
      hintGames: overall?.hint_games ?? 0,
      hintWins: overall?.hint_wins ?? 0,
      currentStreak: overall?.current_streak ?? 0,
      maxStreak: overall?.max_streak ?? 0,
      guessDistribution: overall?.guess_distribution ?? [0, 0, 0, 0, 0, 0],
      byDifficulty,
    });
  };

  const statsToImportPayload = (sourceStats: Stats) => {
    const normalized = normalizeStats(sourceStats);
    const scopePayload = (scopeStats: Stats | DifficultyStats, scoreScope?: string) => ({
      games_played: scopeStats.gamesPlayed ?? 0,
      wins: scopeStats.wins ?? 0,
      losses: 'losses' in scopeStats ? scopeStats.losses : Math.max((scopeStats.gamesPlayed ?? 0) - (scopeStats.wins ?? 0), 0),
      current_streak: scopeStats.currentStreak ?? 0,
      max_streak: scopeStats.maxStreak ?? 0,
      hint_games: scopeStats.hintGames ?? 0,
      hint_wins: scopeStats.hintWins ?? 0,
      guess_distribution: Array.isArray(scopeStats.guessDistribution) ? scopeStats.guessDistribution : [0, 0, 0, 0, 0, 0],
      scope: scoreScope,
    });
    const payload: Record<string, unknown> = { overall: scopePayload(normalized, 'overall') };
    for (const scope of ['easy', 'moderate', 'difficult', 'prodigy']) {
      const diffStats = normalized.byDifficulty?.[scope];
      if (diffStats?.gamesPlayed) payload[scope] = scopePayload(diffStats, scope);
    }
    return payload;
  };

  const getUtcWeekKey = (date = new Date()) => {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  };

  const saveCompletedWeeklyStats = async (didWin: boolean, guessCount: number, usedHints: boolean, statDifficulty: string) => {
    const weekKey = getUtcWeekKey();
    const storedValue = await AsyncStorage.getItem(WEEKLY_STATS_STORAGE_KEY);
    const stored = storedValue ? JSON.parse(storedValue) : null;
    const baseStats = stored?.weekKey === weekKey ? normalizeStats(stored.stats) : normalizeStats(defaultStats);
    const nextStats = buildUpdatedStats(didWin, guessCount, usedHints, baseStats, statDifficulty);
    await AsyncStorage.setItem(WEEKLY_STATS_STORAGE_KEY, JSON.stringify({ weekKey, stats: nextStats }));
    return nextStats;
  };

  const syncLocalStatsToLeaderboard = async (profile: LeaderboardProfile) => {
    try {
      const storedValue = await AsyncStorage.getItem(STATS_STORAGE_KEY);
      if (!storedValue) return;
      const localStats = normalizeStats(JSON.parse(storedValue));
      if (!localStats.gamesPlayed) return;
      const weekKey = getUtcWeekKey();
      const weeklyValue = await AsyncStorage.getItem(WEEKLY_STATS_STORAGE_KEY);
      const weekly = weeklyValue ? JSON.parse(weeklyValue) : null;
      const weeklyStats = weekly?.weekKey === weekKey ? normalizeStats(weekly.stats) : null;
      const importKey = [
        STATS_IMPORT_PREFIX,
        profile.user_id,
        localStats.gamesPlayed,
        localStats.wins,
        localStats.maxStreak,
        weekKey,
        weeklyStats?.gamesPlayed ?? 0,
        weeklyStats?.wins ?? 0,
        weeklyStats?.maxStreak ?? 0,
      ].join('_');
      if (await AsyncStorage.getItem(importKey)) return;
      const res = await fetch(`${API_URL}/players/stats/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: profile.user_id,
          leaderboard_token: profile.leaderboard_token,
          stats_by_scope: statsToImportPayload(localStats),
          weekly_stats_by_scope: weeklyStats ? statsToImportPayload(weeklyStats) : undefined,
        }),
      });
      if (!res.ok) return;
      await AsyncStorage.setItem(importKey, '1');
      await hydrateStatsFromPublicProfile(profile.user_id);
    } catch {
      // Local leaderboard sync is best-effort.
    }
  };

  const hydrateStatsFromPublicProfile = async (userId: string) => {
    try {
      const res = await fetch(`${API_URL}/players/${encodeURIComponent(userId)}/public-profile`);
      if (!res.ok) return;
      const profile: PublicProfile = await res.json();
      const remoteStats = publicProfileToStats(profile);
      const storedValue = await AsyncStorage.getItem(STATS_STORAGE_KEY);
      const storedStats = storedValue ? normalizeStats(JSON.parse(storedValue)) : normalizeStats(stats);
      if (remoteStats.gamesPlayed < storedStats.gamesPlayed) return;
      setStats(remoteStats);
      await AsyncStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(remoteStats));
    } catch {
      // Public stats hydration is best-effort and should not interrupt gameplay.
    }
  };

  const saveAndSetStats = async (s: Stats) => {
    const normalized = normalizeStats(s);
    setStats(normalized);
    await AsyncStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(normalized));
  };

  const buildUpdatedStats = (
    didWin: boolean,
    guessCount: number,
    usedHints = hintsUsed > 0,
    baseStats: Stats = stats,
    statDifficulty = difficulty,
  ) => {
    const nextStats = normalizeStats(baseStats);
    const diffStats = { ...emptyDifficultyStats(), ...(nextStats.byDifficulty[statDifficulty] ?? {}) };
    const overallGuessDistribution = [...nextStats.guessDistribution];
    const diffGuessDistribution = [...diffStats.guessDistribution];

    nextStats.gamesPlayed += 1;
    diffStats.gamesPlayed += 1;
    if (usedHints) {
      nextStats.hintGames += 1;
      diffStats.hintGames += 1;
    }

    if (didWin) {
      overallGuessDistribution[guessCount - 1] = (overallGuessDistribution[guessCount - 1] ?? 0) + 1;
      diffGuessDistribution[guessCount - 1] = (diffGuessDistribution[guessCount - 1] ?? 0) + 1;
      const overallStreak = nextStats.currentStreak + 1;
      const diffStreak = diffStats.currentStreak + 1;
      nextStats.wins += 1;
      if (usedHints) nextStats.hintWins += 1;
      nextStats.currentStreak = overallStreak;
      nextStats.maxStreak = Math.max(nextStats.maxStreak, overallStreak);
      diffStats.wins += 1;
      if (usedHints) diffStats.hintWins += 1;
      diffStats.currentStreak = diffStreak;
      diffStats.maxStreak = Math.max(diffStats.maxStreak, diffStreak);
    } else {
      nextStats.currentStreak = 0;
      diffStats.currentStreak = 0;
      diffStats.losses += 1;
    }

    nextStats.guessDistribution = overallGuessDistribution;
    diffStats.guessDistribution = diffGuessDistribution;
    nextStats.byDifficulty = { ...nextStats.byDifficulty, [statDifficulty]: diffStats };
    return nextStats;
  };

  const saveCompletedStats = async (didWin: boolean, guessCount: number, usedHints = hintsUsed > 0, statDifficulty = difficulty) => {
    const storedValue = await AsyncStorage.getItem(STATS_STORAGE_KEY);
    const baseStats = storedValue ? normalizeStats(JSON.parse(storedValue)) : normalizeStats(stats);
    const nextStats = buildUpdatedStats(didWin, guessCount, usedHints, baseStats, statDifficulty);
    await saveAndSetStats(nextStats);
    await saveCompletedWeeklyStats(didWin, guessCount, usedHints, statDifficulty);
    if (leaderboardProfile?.user_id) {
      setTimeout(() => void syncLocalStatsToLeaderboard(leaderboardProfile), 700);
    }
  };

  const recordDailyCompletion = async (didWin: boolean, completedDate: string | null) => {
    if (!completedDate) return;
    try {
      const storedValue = await AsyncStorage.getItem(DAILY_STORAGE_KEY);
      const saved = storedValue ? JSON.parse(storedValue) : {};
      if (saved?.lastPlayedDate === completedDate) {
        setDailyStreak(saved?.streak ?? 0);
        return;
      }
      const yesterday = new Date(`${completedDate}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayKey = yesterday.toISOString().slice(0, 10);
      const nextStreak = didWin
        ? saved?.lastWinDate === yesterdayKey
          ? (saved?.streak ?? 0) + 1
          : 1
        : 0;
      const next = {
        streak: nextStreak,
        lastPlayedDate: completedDate,
        lastWinDate: didWin ? completedDate : saved?.lastWinDate ?? null,
      };
      setDailyStreak(nextStreak);
      await AsyncStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Daily streaks are local-only and should never block result display.
    }
  };

  const showToast = (message: string, type: Toast['type'] = 'error') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState({ message, type });
    toastTimer.current = setTimeout(() => setToastState(null), 2400);
  };

  const registerLeaderboardProfile = async (username: string, emoji = '🙂') => {
    try {
      const res = await fetch(`${API_URL}/players/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          emoji,
          user_id: leaderboardProfile?.user_id,
          leaderboard_token: leaderboardProfile?.leaderboard_token,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.detail || 'Could not save username', res.status === 409 ? 'warning' : 'error');
        return false;
      }
      const profile: LeaderboardProfile = {
        user_id: data.user_id,
        username: data.username,
        emoji: data.emoji || emoji,
        leaderboard_token: data.leaderboard_token,
      };
      setLeaderboardProfile(profile);
      setPlayerName(profile.username);
      setPlayerEmoji(profile.emoji);
      await AsyncStorage.setItem(LEADERBOARD_PROFILE_KEY, JSON.stringify(profile));
      void syncLocalStatsToLeaderboard(profile);
      showToast('Leaderboard profile ready', 'info');
      return true;
    } catch {
      showToast('Could not reach leaderboard service', 'error');
      return false;
    }
  };

  const checkUsername = async (username: string) => {
    try {
      const res = await fetch(`${API_URL}/players/check-username?username=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error('check username');
      const data = await res.json();
      return { available: !!data.available, valid: !!data.valid, message: data.message ?? null };
    } catch {
      return { available: false, valid: false, message: 'Could not check username' };
    }
  };

  const fetchLeaderboard = async (scope = 'overall', period: 'weekly' | 'all_time' = 'weekly') => {
    try {
      if (leaderboardProfile) {
        await syncLocalStatsToLeaderboard(leaderboardProfile);
      }
      const current = leaderboardProfile?.user_id ? `&player_id=${encodeURIComponent(leaderboardProfile.user_id)}` : '';
      const res = await fetch(`${API_URL}/leaderboard?scope=${encodeURIComponent(scope)}&period=${encodeURIComponent(period)}&limit=50${current}`);
      if (!res.ok) throw new Error('leaderboard');
      return await res.json();
    } catch {
      showToast('Could not load leaderboard', 'warning');
      return null;
    }
  };

  const fetchPublicProfile = async (userId: string) => {
    try {
      const res = await fetch(`${API_URL}/players/${encodeURIComponent(userId)}/public-profile`);
      if (!res.ok) throw new Error('profile');
      return await res.json();
    } catch {
      showToast('Could not load public profile', 'warning');
      return null;
    }
  };

  const triggerShake = () => setInvalidShake(v => v + 1);

  const resetBoardState = () => {
    setGuesses([]);
    setResults([]);
    setCurrentGuess('');
    currentGuessRef.current = '';
    sessionIdRef.current = null;
    setGameStatus('playing');
    setLetterStates({});
    setHints([]);
    setHintsUsed(0);
    setInvalidShake(0);
    setLastSubmittedRow(-1);
    setAnswer(null);
    setAnswerInfo(null);
    setTypingPlayerName(null);
    setTypingPlayerEmoji(null);
    setToastState(null);
    localInputVersion.current = 0;
    lastGuessCountRef.current = 0;
    localDraftActiveRef.current = false;
  };

  const buildLetterStates = (
    syncedGuesses: string[],
    syncedResults: string[][],
    diff: string,
  ) => {
    const isHardOrProdigy = ['difficult', 'prodigy'].includes(diff);
    const nextStates: Record<string, 'correct' | 'present' | 'absent' | 'empty' | 'banned'> = {};

    syncedGuesses.forEach((guess, guessIndex) => {
      const row = syncedResults[guessIndex] ?? [];
      for (let i = 0; i < guess.length; i++) {
        const ch = guess[i];
        const state = row[i];
        if (state === 'correct') {
          nextStates[ch] = 'correct';
        } else if (state === 'present' && nextStates[ch] !== 'correct') {
          nextStates[ch] = 'present';
        } else if (state === 'absent' && !nextStates[ch]) {
          nextStates[ch] = isHardOrProdigy ? 'banned' : 'absent';
        }
      }
    });

    return nextStates;
  };

  const applyBoard = (board: BoardState | null) => {
    if (!board) return;
    const nextGuessCount = board.guesses?.length ?? 0;
    const previousSessionId = sessionIdRef.current;
    const sessionChanged = board.session_id !== previousSessionId;
    const guessCountChanged = nextGuessCount !== lastGuessCountRef.current;
    const serverInputVersion = board.input_version ?? 0;
    if (sessionChanged) {
      localDraftActiveRef.current = false;
      currentGuessRef.current = '';
    }
    const shouldKeepLocalGuess = !sessionChanged
      && !guessCountChanged
      && (
        localDraftActiveRef.current
        || Date.now() - lastLocalInputAt.current < 1500
        || (currentGuessRef.current.length > 0 && serverInputVersion <= localInputVersion.current)
      );
    setSessionId(board.session_id);
    sessionIdRef.current = board.session_id;
    setWordLength(board.length);
    setDifficulty(board.difficulty);
    setGuesses(board.guesses ?? []);
    setResults(board.results ?? []);
    lastGuessCountRef.current = nextGuessCount;
    if (!shouldKeepLocalGuess) {
      setCurrentGuess(board.current_guess ?? '');
      currentGuessRef.current = board.current_guess ?? '';
      localInputVersion.current = Math.max(localInputVersion.current, serverInputVersion);
      localDraftActiveRef.current = false;
    } else if (guessCountChanged) {
      setCurrentGuess('');
      currentGuessRef.current = '';
      localDraftActiveRef.current = false;
    }
    setLetterStates(buildLetterStates(board.guesses ?? [], board.results ?? [], board.difficulty));
    setGameStatus(board.won ? 'won' : board.game_over ? 'lost' : 'playing');
    setAnswer(board.answer ?? null);
    setAnswerInfo(board.answer_info ?? null);
    setHintsUsed(board.hints_used ?? 0);
    if (board.hints) setHints(board.hints);
  };

  const applyRoomState = (data: any, currentPlayerId = playerId) => {
    const boardMode: ActiveBoard = data.active_board === 'individual' ? 'individual' : 'shared';
    const nextShared = data.shared_board ?? null;
    const nextIndividual = data.individual_board ?? null;
    const active = boardMode === 'individual' ? nextIndividual : nextShared;

    setRoomId(data.room_id);
    setRoomPlayers(data.players ?? []);
    setMaxRoomPlayers(data.max_players ?? 8);
    setLivekit(data.livekit ?? null);
    setActiveBoardState(boardMode);
    setSharedBoard(nextShared);
    setIndividualBoard(nextIndividual);
    setShareRequest(data.share_request ?? null);
    setChatMessages(data.chat_messages ?? []);
    setTypingPlayerName(data.typing_player_id === currentPlayerId ? null : data.typing_player_name ?? null);
    setTypingPlayerEmoji(data.typing_player_id === currentPlayerId ? null : data.typing_player_emoji ?? null);
    applyBoard(active ?? {
      session_id: data.session_id,
      difficulty: data.difficulty,
      length: data.length,
      guesses: data.guesses ?? [],
      results: data.results ?? [],
      current_guess: data.current_guess ?? '',
      input_version: data.input_version ?? 0,
      game_over: data.game_over,
      won: data.won,
      answer: data.answer,
      answer_info: data.answer_info,
      hints_used: data.hints_used ?? 0,
      hints: data.hints ?? [],
    });
  };

  const recordRecoveredSoloCompletion = async (board: BoardState) => {
    if (roomId || !board.game_over || locallyRecordedSessionsRef.current.has(board.session_id)) return;
    locallyRecordedSessionsRef.current.add(board.session_id);
    await saveCompletedStats(!!board.won, board.guesses?.length ?? 0, (board.hints_used ?? 0) > 0, board.difficulty);
  };

  const recoverSubmittedGuess = async (submittedGuess: string) => {
    try {
      if (roomId && playerId) {
        const res = await fetch(`${API_URL}/rooms/${roomId}?player_id=${playerId}`);
        if (!res.ok) return false;
        const data = await res.json();
        const active = data.active_board === 'individual' ? data.individual_board : data.shared_board;
        const landed = !!active?.guesses?.includes(submittedGuess) || !!data.guesses?.includes(submittedGuess);
        applyRoomState(data, playerId);
        return landed || !!active?.game_over || !!data.game_over;
      }

      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return false;
      const res = await fetch(`${API_URL}/sessions/${activeSessionId}`);
      if (!res.ok) return false;
      const board: BoardState = await res.json();
      const landed = !!board.guesses?.includes(submittedGuess);
      applyBoard(board);
      await recordRecoveredSoloCompletion(board);
      return landed || !!board.game_over;
    } catch {
      return false;
    }
  };

  const persistRoom = async (data: any, name: string, emoji: string) => {
    await AsyncStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({
      roomId: data.room_id,
      playerId: data.player_id,
      playerName: name.trim() || 'Player',
      playerEmoji: emoji || '🙂',
    }));
  };

  const startGame = async (diff: string) => {
    try {
      const leaderboardQuery = leaderboardProfile
        ? `&leaderboard_user_id=${encodeURIComponent(leaderboardProfile.user_id)}&leaderboard_token=${encodeURIComponent(leaderboardProfile.leaderboard_token)}`
        : '';
      const res = await fetch(`${API_URL}/word?difficulty=${diff}${leaderboardQuery}`);
      const data = await res.json();
      resetBoardState();
      setDailyDate(null);
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setRoomId(null);
      setPlayerId(null);
      setPlayerEmoji('🙂');
      setRoomPlayers([]);
      setMaxRoomPlayers(8);
      setTypingPlayerName(null);
      setTypingPlayerEmoji(null);
      setLivekit(null);
      setActiveBoardState('shared');
      setSharedBoard(null);
      setIndividualBoard(null);
      setShareRequest(null);
      setChatMessages([]);
      AsyncStorage.removeItem(ROOM_STORAGE_KEY);
      setWordLength(data.length);
      setDifficulty(diff);
      trackEvent('Game Started', { mode: 'solo', difficulty: diff });
    } catch {
      showToast('Cannot reach backend - is it running?', 'error');
    }
  };

  const startDailyGame = async () => {
    try {
      const todayKey = new Date().toISOString().slice(0, 10);
      const storedDaily = await AsyncStorage.getItem(DAILY_STORAGE_KEY);
      if (storedDaily) {
        const saved = JSON.parse(storedDaily);
        if (saved?.lastPlayedDate === todayKey) {
          setDailyStreak(saved?.streak ?? 0);
          showToast(`Today's daily puzzle is already played. Streak: ${saved?.streak ?? 0}`, 'info');
          return;
        }
      }
      const leaderboardQuery = leaderboardProfile
        ? `?leaderboard_user_id=${encodeURIComponent(leaderboardProfile.user_id)}&leaderboard_token=${encodeURIComponent(leaderboardProfile.leaderboard_token)}`
        : '';
      const res = await fetch(`${API_URL}/daily-word${leaderboardQuery}`);
      if (!res.ok) throw new Error('daily');
      const data = await res.json();
      resetBoardState();
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setDailyDate(data.daily_date ?? null);
      setRoomId(null);
      setPlayerId(null);
      setPlayerEmoji('🙂');
      setRoomPlayers([]);
      setMaxRoomPlayers(8);
      setTypingPlayerName(null);
      setTypingPlayerEmoji(null);
      setLivekit(null);
      setActiveBoardState('shared');
      setSharedBoard(null);
      setIndividualBoard(null);
      setShareRequest(null);
      setChatMessages([]);
      AsyncStorage.removeItem(ROOM_STORAGE_KEY);
      setWordLength(data.length);
      setDifficulty('easy');
      trackEvent('Game Started', { mode: 'daily', difficulty: 'easy' });
    } catch {
      showToast("Cannot load today's puzzle", 'error');
    }
  };

  const createRoom = async (diff: string, name: string, emoji = '🙂') => {
    try {
      const res = await fetch(`${API_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          difficulty: diff,
          player_name: leaderboardProfile?.username || name,
          player_emoji: leaderboardProfile?.emoji || emoji,
          leaderboard_user_id: leaderboardProfile?.user_id,
          leaderboard_token: leaderboardProfile?.leaderboard_token,
        }),
      });
      if (!res.ok) throw new Error('Could not create room');

      const data = await res.json();
      const cleanName = leaderboardProfile?.username || name.trim() || 'Player';
      setPlayerId(data.player_id);
      setPlayerName(cleanName);
      setPlayerEmoji(leaderboardProfile?.emoji || emoji);
      await persistRoom(data, cleanName, leaderboardProfile?.emoji || emoji);
      resetBoardState();
      applyRoomState(data, data.player_id);
      showToast(`Room ${data.room_id} is ready`, 'info');
      trackEvent('Room Created', { difficulty: diff });
      return true;
    } catch {
      showToast('Could not create room', 'error');
      return false;
    }
  };

  const joinRoom = async (code: string, name: string, emoji = '🙂') => {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      showToast('Enter a room code', 'error');
      return false;
    }

    try {
      let reusePlayerId = playerId;
      try {
        const savedValue = await AsyncStorage.getItem(ROOM_STORAGE_KEY);
        if (savedValue) {
          const saved = JSON.parse(savedValue);
          if (saved.roomId === normalizedCode && saved.playerId) {
            reusePlayerId = saved.playerId;
          }
        }
      } catch {
        // Rejoin can continue without saved identity.
      }

      const res = await fetch(`${API_URL}/rooms/${normalizedCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: reusePlayerId,
          player_name: leaderboardProfile?.username || name,
          player_emoji: leaderboardProfile?.emoji || emoji,
          leaderboard_user_id: leaderboardProfile?.user_id,
          leaderboard_token: leaderboardProfile?.leaderboard_token,
        }),
      });
      if (res.status === 404) {
        showToast('Room not found', 'error');
        return false;
      }
      if (res.status === 409) {
        showToast('Room is full', 'error');
        return false;
      }
      if (!res.ok) throw new Error('Could not join room');

      const data = await res.json();
      const cleanName = leaderboardProfile?.username || name.trim() || 'Player';
      setPlayerId(data.player_id);
      setPlayerName(cleanName);
      setPlayerEmoji(leaderboardProfile?.emoji || emoji);
      await persistRoom(data, cleanName, leaderboardProfile?.emoji || emoji);
      resetBoardState();
      applyRoomState(data, data.player_id);
      showToast(`Joined room ${data.room_id}`, 'info');
      trackEvent('Room Joined', { room_id: data.room_id });
      return true;
    } catch {
      showToast('Could not join room', 'error');
      return false;
    }
  };

  const leaveRoom = (options: { forgetIdentity?: boolean } = { forgetIdentity: true }) => {
    setRoomId(null);
    setPlayerId(null);
    setPlayerEmoji('🙂');
    setRoomPlayers([]);
    setMaxRoomPlayers(8);
    setTypingPlayerName(null);
    setTypingPlayerEmoji(null);
    setLivekit(null);
    setActiveBoardState('shared');
    setSharedBoard(null);
    setIndividualBoard(null);
    setShareRequest(null);
    setChatMessages([]);
    if (options.forgetIdentity !== false) AsyncStorage.removeItem(ROOM_STORAGE_KEY);
    startGame(difficulty);
  };

  const postRoomAction = async (path: string, body: Record<string, unknown>) => {
    if (!roomId || !playerId) return;
    try {
      const res = await fetch(`${API_URL}/rooms/${roomId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, ...body }),
      });
      if (!res.ok) throw new Error(path);
      const data = await res.json();
      resetBoardState();
      applyRoomState(data, playerId);
    } catch {
      showToast('Could not update room', 'error');
    }
  };

  const createSharedGame = async () => {
    await postRoomAction('shared-game', {});
    trackEvent('Shared Game Started', { difficulty });
  };

  const createIndividualGame = async () => {
    await postRoomAction('individual-game', {});
    trackEvent('Individual Game Started', { difficulty });
  };

  const changeRoomDifficulty = async (nextDifficulty: string) => {
    await postRoomAction('difficulty', { difficulty: nextDifficulty });
    trackEvent('Room Difficulty Changed', { difficulty: nextDifficulty });
  };

  const setActiveBoard = async (board: ActiveBoard) => {
    await postRoomAction('active-board', { board });
    trackEvent('Board Mode Switched', { board });
  };

  const requestShareBoard = async () => {
    await postRoomAction('share-request', {});
    showToast('Board share request sent', 'info');
    trackEvent('Board Share Requested', { difficulty });
  };

  const respondToShareRequest = async (accept: boolean) => {
    await postRoomAction('share-request/respond', { accept });
    trackEvent('Board Share Responded', { accepted: accept });
  };

  const sendChatMessage = async (text: string) => {
    if (!roomId || !playerId) return false;
    try {
      const res = await fetch(`${API_URL}/rooms/${roomId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, text }),
      });
      if (!res.ok) throw new Error('chat');
      const data = await res.json();
      applyRoomState(data, playerId);
      trackEvent('Chat Message Sent', { room_id: roomId });
      return true;
    } catch {
      showToast('Could not send chat message', 'error');
      return false;
    }
  };

  useEffect(() => {
    if (!roomId || !playerId) return;

    const refresh = async () => {
      try {
        const res = await fetch(`${API_URL}/rooms/${roomId}?player_id=${playerId}`);
        if (!res.ok) return;
        const data = await res.json();
        applyRoomState(data, playerId);
      } catch {
        // Transient polling failures should not interrupt the local UI.
      }
    };

    const timer = setInterval(refresh, 450);
    return () => clearInterval(timer);
  }, [roomId, playerId]);

  const getHint = async (level: number) => {
    if (hintsUsed >= 2 || !sessionId) {
      showToast('No hints left for this puzzle', 'warning');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/hint?session_id=${sessionId}&level=${level}`);
      if (res.status === 409) {
        showToast('No hints left for this puzzle', 'warning');
        return;
      }
      if (!res.ok) throw new Error('hint');
      const data = await res.json();
      setHints(prev => [...prev, {
        level: data.level ?? level,
        text: data.hint,
        kind: data.kind,
        revealed_position: data.revealed_position,
        revealed_letter: data.revealed_letter,
      }]);
      setHintsUsed(data.hints_used ?? level);
    } catch {
      showToast('Could not load hint', 'warning');
    }
  };

  const syncRoomInput = (nextGuess: string, version = localInputVersion.current) => {
    const activeRoomId = latestRoomRef.current.roomId;
    const activePlayerId = latestRoomRef.current.playerId;
    if (!activeRoomId || !activePlayerId) return;

    const seq = ++inputSyncSeq.current;
    if (inputSyncTimer.current) clearTimeout(inputSyncTimer.current);
    inputSyncTimer.current = setTimeout(async () => {
      if (seq !== inputSyncSeq.current) return;
      try {
        await fetch(`${API_URL}/rooms/${activeRoomId}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: activePlayerId,
            current_guess: nextGuess,
            client_input_version: version,
          }),
        });
      } catch {
        // Current-letter sync is best effort; polling will repair state.
      }
    }, 90);
  };

  const addLetter = (letter: string) => {
    if (gameStatus !== 'playing') return;
    const guess = currentGuessRef.current;
    if (guess.length < wordLength) {
      const nextGuess = guess + letter;
      currentGuessRef.current = nextGuess;
      localDraftActiveRef.current = true;
      lastLocalInputAt.current = Date.now();
      localInputVersion.current += 1;
      setCurrentGuess(nextGuess);
      syncRoomInput(nextGuess, localInputVersion.current);
    }
  };

  const removeLetter = () => {
    if (gameStatus !== 'playing') return;
    const nextGuess = currentGuessRef.current.slice(0, -1);
    currentGuessRef.current = nextGuess;
    localDraftActiveRef.current = nextGuess.length > 0;
    lastLocalInputAt.current = Date.now();
    localInputVersion.current += 1;
    setCurrentGuess(nextGuess);
    syncRoomInput(nextGuess, localInputVersion.current);
  };

  const submitGuess = async () => {
    const guess = currentGuessRef.current;
    if (submittingRef.current || gameStatus !== 'playing' || !sessionId) return;

    if (guess.length !== wordLength) {
      triggerShake();
      showToast(`Need ${wordLength} letters`, 'error');
      return;
    }

    if (guesses.some(submittedGuess => submittedGuess.toUpperCase() === guess.toUpperCase())) {
      triggerShake();
      showToast('Guess already submitted', 'warning');
      return;
    }

    const isModerateOrHard = ['moderate', 'difficult', 'prodigy'].includes(difficulty);
    const isHardOrProdigy = ['difficult', 'prodigy'].includes(difficulty);

    if (isHardOrProdigy) {
      for (let i = 0; i < guess.length; i++) {
        const l = guess[i];
        if (letterStates[l] === 'absent' || letterStates[l] === 'banned') {
          triggerShake();
          showToast(`'${l}' is eliminated - it is not in the word`, 'error');
          return;
        }
      }
    }

    if (isModerateOrHard && guesses.length > 0) {
      for (let g = 0; g < guesses.length; g++) {
        const pastGuess = guesses[g];
        const pastResult = results[g];
        for (let i = 0; i < wordLength; i++) {
          if (pastResult[i] === 'correct' && guess[i] !== pastGuess[i]) {
            triggerShake();
            showToast(`'${pastGuess[i]}' must stay in position ${i + 1}`, 'error');
            return;
          }
          if (pastResult[i] === 'present' && !guess.includes(pastGuess[i])) {
            triggerShake();
            showToast(`Must include '${pastGuess[i]}' somewhere in your guess`, 'warning');
            return;
          }
        }
      }
    }

    try {
      submittingRef.current = true;
      pendingSubmitRecoveryRef.current = { guess, createdAt: Date.now() };
      if (inputSyncTimer.current) clearTimeout(inputSyncTimer.current);
      inputSyncSeq.current += 1;
      const endpoint = roomId && playerId ? `${API_URL}/rooms/${roomId}/guess` : `${API_URL}/guess`;
      const body = roomId && playerId
        ? {
          player_id: playerId,
          guess,
          leaderboard_user_id: leaderboardProfile?.user_id,
          leaderboard_token: leaderboardProfile?.leaderboard_token,
        }
        : {
          session_id: sessionId,
          guess,
          leaderboard_user_id: leaderboardProfile?.user_id,
          leaderboard_token: leaderboardProfile?.leaderboard_token,
        };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 422) {
        triggerShake();
        showToast('Not in word list', 'error');
        return;
      }
      if (res.status === 409) {
        const recovered = await recoverSubmittedGuess(guess);
        if (recovered) {
          pendingSubmitRecoveryRef.current = null;
        } else {
          pendingSubmitRecoveryRef.current = null;
          showToast('That guess is already being submitted', 'warning');
        }
        return;
      }
      if (!res.ok) {
        triggerShake();
        showToast('Something went wrong', 'error');
        return;
      }

      const data = await res.json();
      pendingSubmitRecoveryRef.current = null;
      setLastSubmittedRow(guesses.length);
      setCurrentGuess('');
      currentGuessRef.current = '';
      localDraftActiveRef.current = false;
      lastLocalInputAt.current = 0;
      localInputVersion.current += 1;

      if (roomId) {
        applyRoomState(data, playerId);
        trackEvent('Guess Submitted', { mode: 'party', difficulty, guess_count: guesses.length + 1 });
        if (data.won) trackEvent('Game Won', { mode: 'party', difficulty, guesses: guesses.length + 1 });
        else if (data.game_over) trackEvent('Game Lost', { mode: 'party', difficulty, guesses: guesses.length + 1 });
        return;
      }

      const newResults = [...results, data.states];
      const newGuesses = [...guesses, guess];
      setResults(newResults);
      setGuesses(newGuesses);
      trackEvent('Guess Submitted', { mode: 'solo', difficulty, guess_count: newGuesses.length });

      const newStates = { ...letterStates };
      for (let i = 0; i < guess.length; i++) {
        const ch = guess[i];
        const state = data.states[i];
        if (state === 'correct') {
          newStates[ch] = 'correct';
        } else if (state === 'present' && newStates[ch] !== 'correct') {
          newStates[ch] = 'present';
        } else if (state === 'absent' && !newStates[ch]) {
          newStates[ch] = isHardOrProdigy ? 'banned' : 'absent';
        }
      }
      setLetterStates(newStates);

      setTimeout(() => {
        if (data.won) {
          locallyRecordedSessionsRef.current.add(sessionId);
          setAnswer(data.answer);
          setAnswerInfo(data.answer_info ?? null);
          setHintsUsed(data.hints_used ?? hintsUsed);
          setGameStatus('won');
          saveCompletedStats(true, newGuesses.length, (data.hints_used ?? hintsUsed) > 0, difficulty);
          recordDailyCompletion(true, dailyDate);
          trackEvent('Game Won', { mode: 'solo', difficulty, guesses: newGuesses.length });
        } else if (data.game_over) {
          locallyRecordedSessionsRef.current.add(sessionId);
          setAnswer(data.answer);
          setAnswerInfo(data.answer_info ?? null);
          setHintsUsed(data.hints_used ?? hintsUsed);
          setGameStatus('lost');
          saveCompletedStats(false, newGuesses.length, (data.hints_used ?? hintsUsed) > 0, difficulty);
          recordDailyCompletion(false, dailyDate);
          trackEvent('Game Lost', { mode: 'solo', difficulty, guesses: newGuesses.length });
        }
      }, 1600);
    } catch {
      const recovered = await recoverSubmittedGuess(guess);
      if (recovered) {
        pendingSubmitRecoveryRef.current = null;
      } else {
        pendingSubmitRecoveryRef.current = { guess, createdAt: Date.now() };
        showToast('Network is slow - try again when connected', 'warning');
      }
    } finally {
      setTimeout(() => {
        submittingRef.current = false;
      }, 450);
    }
  };

  const maxGuesses = difficulty === 'prodigy' ? 4 : 6;

  return (
    <GameStateContext.Provider value={{
      difficulty, wordLength, sessionId, roomId, playerId, playerName, playerEmoji, leaderboardProfile,
      roomPlayers, maxRoomPlayers, typingPlayerName, typingPlayerEmoji, livekit, activeBoard, sharedBoard, individualBoard, shareRequest, chatMessages,
      guesses, results, currentGuess, gameStatus, letterStates, stats, dailyDate, dailyStreak,
      startGame, startDailyGame, createRoom, joinRoom, leaveRoom, createSharedGame, createIndividualGame,
      registerLeaderboardProfile, checkUsername, fetchLeaderboard, fetchPublicProfile,
      changeRoomDifficulty, setActiveBoard, requestShareBoard, respondToShareRequest, sendChatMessage, addLetter, removeLetter,
      submitGuess, getHint, hints, hintsUsed, invalidShake, lastSubmittedRow,
      answer, answerInfo, maxGuesses, toast,
    }}>
      {children}
    </GameStateContext.Provider>
  );
};

export const useGameState = () => {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be inside GameStateProvider');
  return ctx;
};
