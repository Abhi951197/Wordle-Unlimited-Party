import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Keyboard } from '@/components/Keyboard';
import { VoiceControls } from '@/components/VoiceControls';
import { WordGrid } from '@/components/WordGrid';
import { AchievementProgress, ActiveBoard, AnswerInfo, ChatMessage, FriendPlayer, HintState, LeaderboardEntry, LeaderboardResponse, PublicPlayer, PublicProfile, PublicStatsScope, useGameState } from '@/store/GameState';
import { trackEvent } from '@/utils/analytics';

const DIFF_META: Record<string, { color: string; label: string; desc: string; guesses: string; mark: string }> = {
  easy: { color: '#16C75A', label: 'Easy', desc: 'Classic Wordle rules', guesses: '6 guesses', mark: 'E' },
  moderate: { color: '#FACC15', label: 'Moderate', desc: 'Reuse confirmed letters', guesses: '6 guesses', mark: 'M' },
  difficult: { color: '#EF4444', label: 'Difficult', desc: 'Confirmed letters plus bans', guesses: '6 guesses', mark: 'D' },
  prodigy: { color: '#8B5CF6', label: 'Prodigy', desc: 'Hard rules, only 4 chances', guesses: '4 guesses', mark: 'P' },
};

type AppView = 'splash' | 'mode' | 'difficulty' | 'party' | 'roomCreated' | 'solo';
type PlayMode = 'solo' | 'party';
type StatsTab = 'overall' | 'easy' | 'moderate' | 'difficult' | 'prodigy';
type LeaderboardTab = StatsTab | 'rules';
type LeaderboardPeriod = 'weekly' | 'all_time';

interface RecentRoom {
  roomId: string;
  name: string;
  joinedAt: string;
}

interface AppSettings {
  sound: boolean;
  vibration: boolean;
  voiceChat: boolean;
  defaultDifficulty: string;
  theme: 'dark' | 'light';
}

const RECENT_ROOMS_KEY = 'word_recent_rooms';
const SETTINGS_KEY = 'word_app_settings';
const PLAYER_EMOJIS = ['🙂', '😎', '🔥', '🚀', '🧠', '🎯', '⭐', '👑', '🍀', '⚡'];
const EMOJI_GROUPS = [
  ['🙂', '😀', '😄', '😎', '🤩', '😂', '🥳', '🤝'],
  ['🔥', '🚀', '⚡', '🎯', '🏆', '⭐', '💎', '🍀'],
  ['👑', '🧠', '🎮', '🎲', '💬', '☕', '🌙', '🌈'],
];
const QUICK_CHATS = ['Nice guess', 'Try vowels', 'I have an idea', 'Go for it', 'One more', 'Share board?'];
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8000';

const PALETTES = {
  dark: {
    bg: '#0B0F16', surface: '#111827', panel: '#151C27', input: '#151C27', border: '#283447',
    text: '#F8FAFC', muted: '#9CA3AF', subtle: '#D1D5DB', accent: '#16C75A', blue: '#60A5FA',
    purple: '#8B5CF6', danger: '#EF4444', warning: '#FACC15', overlay: 'rgba(0,0,0,0.68)',
  },
  light: {
    bg: '#F4F7FB', surface: '#FFFFFF', panel: '#FFFFFF', input: '#F8FAFC', border: '#D6DEE9',
    text: '#111827', muted: '#64748B', subtle: '#334155', accent: '#16A34A', blue: '#2563EB',
    purple: '#7C3AED', danger: '#DC2626', warning: '#D97706', overlay: 'rgba(15,23,42,0.26)',
  },
} as const;
type Palette = (typeof PALETTES)[keyof typeof PALETTES];

const ToastBanner: React.FC<{ message: string; type: 'error' | 'warning' | 'info' }> = ({ message, type }) => {
  const bg = type === 'error' ? '#EF4444' : type === 'warning' ? '#FACC15' : '#16C75A';
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(220)} style={[styles.toast, { backgroundColor: bg }]}>
      <Text style={[styles.toastText, type === 'warning' && styles.warningToastText]}>{message}</Text>
    </Animated.View>
  );
};

export default function GameScreen() {
  const {
    startGame, startDailyGame, createRoom, joinRoom, leaveRoom, createSharedGame, createIndividualGame, createWordChallenge, changeRoomDifficulty,
    registerLeaderboardProfile, checkUsername, fetchLeaderboard, fetchPublicProfile, leaderboardProfile,
    friendsState, pendingPartyInvite, fetchFriends, searchPlayers, sendFriendRequest, respondFriendRequest, removeFriend, inviteFriendToRoom, respondPartyInvite, clearPendingPartyInvite,
    setActiveBoard, requestShareBoard, respondToShareRequest, gameStatus, currentGuess,
    addLetter, removeLetter, submitGuess, guesses, results, wordLength, letterStates,
    sessionId, difficulty, roomId, playerId, playerEmoji, roomPlayers, maxRoomPlayers, typingPlayerName, typingPlayerEmoji, livekit, activeBoard,
    wordChallenge, shareRequest, chatMessages, sendChatMessage, stats, invalidShake, lastSubmittedRow, answer, answerInfo, maxGuesses, toast, dailyDate, dailyStreak,
    getHint, hints, hintsUsed,
  } = useGameState();

  const { width, height } = useWindowDimensions();
  const isWide = width >= 760;
  const isShort = height < 740;
  const supportsVibration = Platform.OS !== 'web'
    || (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function');
  const [view, setView] = useState<AppView>('mode');
  const [selectedMode, setSelectedMode] = useState<PlayMode>('solo');
  const [diffModal, setDiffModal] = useState(false);
  const [statsModal, setStatsModal] = useState(false);
  const [helpModal, setHelpModal] = useState(false);
  const [roomModal, setRoomModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [emojiModal, setEmojiModal] = useState(false);
  const [chatModal, setChatModal] = useState(false);
  const [hintModal, setHintModal] = useState(false);
  const [leaderboardModal, setLeaderboardModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [friendsModal, setFriendsModal] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendResults, setFriendResults] = useState<PublicPlayer[]>([]);
  const [friendSearching, setFriendSearching] = useState(false);
  const [openFriendMenuId, setOpenFriendMenuId] = useState<string | null>(null);
  const [pendingInviteUserId, setPendingInviteUserId] = useState<string | null>(null);
  const [pendingInviteStartedAt, setPendingInviteStartedAt] = useState(0);
  const [leaderboardTab, setLeaderboardTab] = useState<LeaderboardTab>('overall');
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>('weekly');
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [publicProfileModal, setPublicProfileModal] = useState(false);
  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [publicProfileLoading, setPublicProfileLoading] = useState(false);
  const [publicProfileTab, setPublicProfileTab] = useState<StatsTab>('overall');
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameStatus, setUsernameStatus] = useState('');
  const [seenChatId, setSeenChatId] = useState<string | null>(null);
  const [chatPopupVisible, setChatPopupVisible] = useState(false);
  const [challengeModal, setChallengeModal] = useState(false);
  const [challengeWord, setChallengeWord] = useState('');
  const [challengeError, setChallengeError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('🙂');
  const [nameError, setNameError] = useState('');
  const [recentWarning, setRecentWarning] = useState('');
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [joinCode, setJoinCode] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ sound: true, vibration: true, voiceChat: true, defaultDifficulty: 'easy', theme: 'dark' });
  const [statsTab, setStatsTab] = useState<StatsTab>('overall');
  const [showResultOverlay, setShowResultOverlay] = useState(false);
  const palette = PALETTES[settings.theme];
  const themed = useMemo(() => createThemeStyles(palette), [palette]);
  const latestChat = chatMessages[chatMessages.length - 1];
  const hasUnreadChat = !!latestChat && latestChat.message_id !== seenChatId;

  useEffect(() => {
    if (!latestChat || latestChat.message_id === seenChatId) return;
    setChatPopupVisible(true);
    const timer = setTimeout(() => setChatPopupVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [latestChat?.message_id, seenChatId]);

  useEffect(() => {
    if (chatModal && latestChat) {
      setSeenChatId(latestChat.message_id);
      setChatPopupVisible(false);
    }
  }, [chatModal, latestChat?.message_id]);

  useEffect(() => {
    if (!pendingPartyInvite) return;
    const createdAt = new Date(pendingPartyInvite.created_at).getTime();
    const elapsed = Number.isFinite(createdAt) ? Date.now() - createdAt : 0;
    const remaining = Math.max(((pendingPartyInvite.expires_in ?? 30) * 1000) - elapsed, 0);
    const timer = setTimeout(() => {
      void respondPartyInvite(pendingPartyInvite.invite_id, false);
      clearPendingPartyInvite();
    }, remaining || 100);
    return () => clearTimeout(timer);
  }, [pendingPartyInvite?.invite_id]);

  useEffect(() => {
    if (!pendingInviteUserId) return;
    if (Date.now() - pendingInviteStartedAt < 1500) return;
    const stillPending = friendsState?.outgoing_party_invites?.some(invite => invite.to_player.user_id === pendingInviteUserId);
    if (friendsState && !stillPending) setPendingInviteUserId(null);
  }, [friendsState?.outgoing_party_invites?.length, pendingInviteUserId, pendingInviteStartedAt]);

  useEffect(() => {
    if (!sessionId && gameStatus === 'playing') startGame(difficulty);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const roomParam = new URLSearchParams(window.location.search).get('room');
    if (!roomParam) return;
    setJoinCode(roomParam.toUpperCase());
    if (!roomId) {
      setSelectedMode('party');
      setView('party');
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    if (view === 'splash') setView('party');
  }, [roomId, view]);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_ROOMS_KEY).then(value => {
      if (value) setRecentRooms(JSON.parse(value));
    });
    AsyncStorage.getItem(SETTINGS_KEY).then(value => {
      if (value) setSettings(prev => ({ ...prev, ...JSON.parse(value) }));
    });
  }, []);

  useEffect(() => {
    if (gameStatus === 'playing') {
      setShowResultOverlay(false);
      return;
    }
    playFeedback(gameStatus === 'won' ? 'win' : 'submit', false);
    const timer = setTimeout(() => setShowResultOverlay(true), 1000);
    return () => clearTimeout(timer);
  }, [gameStatus, sessionId]);

  useEffect(() => {
    if (!leaderboardProfile) return;
    setRoomName(leaderboardProfile.username);
    setSelectedEmoji(leaderboardProfile.emoji || selectedEmoji);
  }, [leaderboardProfile?.user_id]);

  useEffect(() => {
    if (!friendsModal || friendSearch.trim().length < 2) {
      setFriendResults([]);
      return;
    }
    let cancelled = false;
    setFriendSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchPlayers(friendSearch);
      if (!cancelled) {
        setFriendResults(results);
        setFriendSearching(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [friendsModal, friendSearch]);

  useEffect(() => {
    if (roomId) void saveRecentRoom(roomId, roomName);
  }, [roomId]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((view !== 'solo' && view !== 'party') || gameStatus !== 'playing') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        playFeedback('delete');
        removeLetter();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        playFeedback('submit');
        void submitGuess();
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        playFeedback('key');
        addLetter(event.key.toUpperCase());
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [view, gameStatus, settings.sound, settings.vibration, addLetter, removeLetter, submitGuess]);

  const activeMeta = DIFF_META[difficulty] ?? DIFF_META.easy;
  const shareFromMe = shareRequest?.from_player_id === playerId;
  const hasShareForMe = !!shareRequest && !shareFromMe;

  const featureLine = useMemo(() => ['Solo & Party Mode', 'Voice Chat', 'Real-time Sync', 'Multiple Difficulties'], []);

  const saveRecentRoom = async (nextRoomId: string, name: string) => {
    const next: RecentRoom = { roomId: nextRoomId, name: name.trim() || 'My Room', joinedAt: new Date().toISOString() };
    const merged = [next, ...recentRooms.filter(room => room.roomId !== nextRoomId)].slice(0, 5);
    setRecentRooms(merged);
    await AsyncStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(merged));
  };

  const removeRecentRoom = async (staleRoomId: string) => {
    const merged = recentRooms.filter(room => room.roomId !== staleRoomId);
    setRecentRooms(merged);
    await AsyncStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(merged));
  };

  const updateSetting = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const checkRoomLive = async (code: string) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return false;
    try {
      const res = await fetch(`${API_URL}/rooms/${normalized}`);
      if (res.status === 404) return false;
      return res.ok;
    } catch {
      return false;
    }
  };

  const chooseRecentRoom = async (recent: RecentRoom) => {
    setRecentWarning('');
    const live = await checkRoomLive(recent.roomId);
    if (!live) {
      await removeRecentRoom(recent.roomId);
      setRecentWarning('This room is not live right now. Join another room.');
      return;
    }
    setJoinCode(recent.roomId);
  };

  const sendChat = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    const sent = await sendChatMessage(message);
    if (sent) {
      setChatInput('');
      setChatPopupVisible(false);
    }
  };

  const refreshLeaderboard = async (scope: LeaderboardTab = leaderboardTab, period: LeaderboardPeriod = leaderboardPeriod) => {
    if (scope === 'rules') return;
    setLeaderboardLoading(true);
    const data = await fetchLeaderboard(scope, period);
    setLeaderboardData(data);
    setLeaderboardLoading(false);
  };

  const openLeaderboard = async (scope: LeaderboardTab = 'overall', period: LeaderboardPeriod = leaderboardPeriod) => {
    setLeaderboardTab(scope);
    setLeaderboardPeriod(period);
    setLeaderboardModal(true);
    if (scope !== 'rules') await refreshLeaderboard(scope, period);
  };

  const selectLeaderboardPeriod = async (period: LeaderboardPeriod) => {
    setLeaderboardPeriod(period);
    if (leaderboardTab !== 'rules') await refreshLeaderboard(leaderboardTab, period);
  };

  const openPublicProfile = async (entry: LeaderboardEntry) => {
    setPublicProfileModal(true);
    setPublicProfileLoading(true);
    setPublicProfileTab('overall');
    setPublicProfile(null);
    const profile = await fetchPublicProfile(entry.user_id);
    setPublicProfile(profile);
    setPublicProfileLoading(false);
  };

  const openPlayerProfile = async (player: PublicPlayer) => {
    setPublicProfileModal(true);
    setPublicProfileLoading(true);
    setPublicProfileTab('overall');
    setPublicProfile(null);
    const profile = await fetchPublicProfile(player.user_id);
    setPublicProfile(profile);
    setPublicProfileLoading(false);
  };

  const isFriend = (userId?: string) => !!userId && !!friendsState?.friends.some(friend => friend.user_id === userId);
  const hasOutgoingFriendRequest = (userId?: string) => !!userId && !!friendsState?.outgoing_requests.some(request => request.to_player?.user_id === userId);

  const saveLeaderboardProfile = async () => {
    const username = usernameInput.trim();
    if (!username) {
      setUsernameStatus('Choose a username first.');
      return;
    }
    const check = await checkUsername(username);
    if (!check.valid || !check.available) {
      setUsernameStatus(check.message || 'That username is not available.');
      return;
    }
    const saved = await registerLeaderboardProfile(username, selectedEmoji);
    if (saved) {
      setRoomName(username.toLowerCase());
      setProfileModal(false);
      setUsernameStatus('');
    }
  };

  const ensureLeaderboardProfile = () => {
    if (leaderboardProfile) return true;
    setUsernameInput(roomName.trim().replace(/\s+/g, '_').toLowerCase());
    setProfileModal(true);
    return false;
  };

  const openFriends = async () => {
    if (!leaderboardProfile && !ensureLeaderboardProfile()) return;
    setFriendsModal(true);
    await fetchFriends();
  };

  function playFeedback(kind: 'key' | 'delete' | 'submit' | 'win', vibrate = true) {
    if (settings.sound && Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextCtor) {
          const ctx = new AudioContextCtor();
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          const duration = kind === 'win' ? 0.22 : 0.055;
          oscillator.frequency.value = kind === 'win' ? 740 : kind === 'submit' ? 420 : 260;
          oscillator.type = 'sine';
          gain.gain.value = kind === 'win' ? 0.06 : 0.035;
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start();
          oscillator.stop(ctx.currentTime + duration);
          setTimeout(() => ctx.close?.(), (duration + 0.05) * 1000);
        }
      } catch {
        // Sound is a preference, so failures should stay invisible.
      }
    }

    if (!vibrate || !settings.vibration) return;
    if (Platform.OS === 'web') {
      navigator?.vibrate?.(kind === 'submit' ? 24 : 10);
      return;
    }
    void Haptics.impactAsync(kind === 'submit' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  }

  const handleLetterPress = (letter: string) => {
    playFeedback('key');
    addLetter(letter);
  };

  const handleDeletePress = () => {
    playFeedback('delete');
    removeLetter();
  };

  const handleSubmitPress = () => {
    playFeedback('submit');
    void submitGuess();
  };

  const getInviteLink = () => {
    if (!roomId) return '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    }
    return `Room code: ${roomId}`;
  };

  const copyRoom = async () => {
    if (!roomId) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      await navigator.clipboard?.writeText(getInviteLink());
    }
  };

  const shareRoom = async () => {
    if (!roomId) return;
    trackEvent('Room Invite Shared', { room_id: roomId });
    const inviteLink = getInviteLink();
    const message = `Join my Wordle Unlimited party room ${roomId}: ${inviteLink}`;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const webNavigator = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
      if (webNavigator.share) {
        await webNavigator.share({ title: 'Wordle Unlimited Party', text: `Join room ${roomId}`, url: inviteLink });
        return;
      }
      await navigator.clipboard?.writeText(message);
      return;
    }
    await Share.share({ title: 'Wordle Unlimited Party', message });
  };

  const chooseMode = (mode: PlayMode) => {
    trackEvent('Mode Selected', { mode });
    setSelectedMode(mode);
    if (mode === 'solo') setView('difficulty');
    else setView('party');
  };

  const chooseDailyMode = async () => {
    trackEvent('Mode Selected', { mode: 'daily' });
    if (!leaderboardProfile && !ensureLeaderboardProfile()) return;
    if (roomId) leaveRoom();
    await startDailyGame();
    setSelectedMode('solo');
    setView('solo');
  };

  const startSelectedDifficulty = async (nextDifficulty = difficulty) => {
    if (!leaderboardProfile && !ensureLeaderboardProfile()) return;
    if (selectedMode === 'solo') {
      if (roomId) leaveRoom();
      await startGame(nextDifficulty);
      setView('solo');
      return;
    }
    await startGame(nextDifficulty);
    setView('party');
  };

  const createParty = async () => {
    if (!leaderboardProfile && !ensureLeaderboardProfile()) return;
    const displayName = leaderboardProfile?.username || roomName;
    if (!displayName.trim()) {
      setNameError('Enter your name to continue');
      return;
    }
    setNameError('');
    const created = await createRoom(difficulty, displayName, leaderboardProfile?.emoji || selectedEmoji);
    if (created) setView('roomCreated');
  };

  const joinParty = async () => {
    if (!leaderboardProfile && !ensureLeaderboardProfile()) return;
    const displayName = leaderboardProfile?.username || roomName;
    if (!displayName.trim()) {
      setNameError('Enter your name to continue');
      return;
    }
    setNameError('');
    setRecentWarning('');
    const targetCode = joinCode.trim().toUpperCase();
    const live = await checkRoomLive(targetCode);
    if (!live) {
      if (targetCode) await removeRecentRoom(targetCode);
      setRecentWarning('This room is not live right now. Join another room.');
      return;
    }
    const joined = await joinRoom(joinCode, displayName, leaderboardProfile?.emoji || selectedEmoji);
    if (joined) {
      if (joinCode.trim()) void saveRecentRoom(joinCode.trim().toUpperCase(), roomName);
      setView('party');
    }
  };

  const acceptPartyInvite = async (inviteId: string, inviteRoomId: string) => {
    if (!leaderboardProfile) return;
    const accepted = await respondPartyInvite(inviteId, true);
    if (!accepted) return;
    const joined = await joinRoom(inviteRoomId, leaderboardProfile.username, leaderboardProfile.emoji || selectedEmoji);
    if (joined) {
      setSelectedMode('party');
      switchBoard('shared');
      setView('party');
      setFriendsModal(false);
    }
  };

  const sendInviteToFriend = async (friendUserId: string) => {
    if (pendingInviteUserId === friendUserId) return;
    setOpenFriendMenuId(null);
    setPendingInviteUserId(friendUserId);
    setPendingInviteStartedAt(Date.now());
    const sent = await inviteFriendToRoom(friendUserId);
    if (sent) {
      setSelectedMode('party');
      setView('party');
      setFriendsModal(false);
      setTimeout(() => setPendingInviteUserId(current => current === friendUserId ? null : current), 30000);
    } else {
      setPendingInviteUserId(null);
    }
  };

  const startWordMasterChallenge = async () => {
    const cleanWord = challengeWord.trim().toUpperCase();
    if (cleanWord.length !== 5 || !/^[A-Z]+$/.test(cleanWord)) {
      setChallengeError('Enter a valid five-letter word.');
      return;
    }
    const started = await createWordChallenge(cleanWord);
    if (started) {
      setChallengeModal(false);
      setChallengeWord('');
      setChallengeError('');
    }
  };

  const switchBoard = (board: ActiveBoard) => {
    if (activeBoard !== board) setActiveBoard(board);
  };

  const changeDifficulty = async (nextDifficulty: string) => {
    setDiffModal(false);
    if (roomId) {
      await changeRoomDifficulty(nextDifficulty);
      setView('party');
      return;
    }
    await startGame(nextDifficulty);
  };

  const roomSubtitle = roomId
    ? `${activeMeta.label} - ${roomPlayers.length || 1}/${maxRoomPlayers} players`
    : 'Create or join a room';
  const selectedProfileFriend = publicProfile
    ? friendsState?.friends.find(friend => friend.user_id === publicProfile.player.user_id)
    : null;

  const goBack = () => {
    if (view === 'splash') return;
    if (view === 'mode') return;
    else if (view === 'difficulty') setView('mode');
    else if (view === 'roomCreated') {
      if (roomId) leaveRoom();
      setView('party');
    }
    else if (view === 'solo') setView('difficulty');
    else if (view === 'party' && !roomId) setView('mode');
    else if (view === 'party' && roomId) {
      leaveRoom();
      setView('mode');
    }
    else setView('mode');
  };

  const renderHeroBrand = () => (
    <View style={styles.brandBlock}>
      <View style={styles.logoMark}><Text style={styles.logoMarkText}>W</Text></View>
      <Text style={styles.brand}>WORDLE <Text style={styles.brandAccent}>UNLIMITED</Text></Text>
      <Text style={styles.homeSubtitle}>Premium Multiplayer Word Game</Text>
      <View style={styles.pillRow}>
        {featureLine.map(item => <Text key={item} style={styles.featurePill}>{item}</Text>)}
      </View>
    </View>
  );

  const renderTopBar = (title: string, subtitle?: string, roomActions = false) => (
    <View style={styles.topBar}>
      <TouchableOpacity style={[styles.smallIconBtn, themed.iconBtn]} onPress={goBack}>
        <Text style={[styles.smallIconText, themed.titleText]}>{'<'}</Text>
      </TouchableOpacity>
      <View style={styles.topTitleWrap}>
        <Text style={[styles.topTitle, themed.titleText]}>{title}</Text>
        {!!subtitle && <Text style={[styles.topSubtitle, themed.mutedText]}>{subtitle}</Text>}
      </View>
      <View style={styles.topActions}>
        {roomId && roomActions && <TouchableOpacity style={[styles.smallIconBtn, themed.iconBtn]} onPress={() => setRoomModal(true)}><IconMark name="info" color={palette.text} /></TouchableOpacity>}
        <TouchableOpacity style={[styles.smallIconBtn, themed.iconBtn]} onPress={() => openLeaderboard('overall')}><Text style={[styles.smallIconText, { color: '#FACC15' }]}>🏆</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.smallIconBtn, themed.iconBtn]} onPress={openFriends}><Text style={[styles.smallIconText, { color: '#60A5FA' }]}>F</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.smallIconBtn, themed.iconBtn]} onPress={() => setDiffModal(true)}><Text style={[styles.smallIconText, { color: activeMeta.color }]}>{activeMeta.mark}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.smallIconBtn, themed.iconBtn]} onPress={() => { trackEvent('Settings Opened'); setSettingsModal(true); }}><IconMark name="dots" color={palette.text} /></TouchableOpacity>
      </View>
    </View>
  );

  const renderPartyActions = () => {
    if (!roomId) return null;
    const canShare = activeBoard === 'individual' && gameStatus === 'playing';
    return (
      <View style={styles.partyActionArea}>
        <View style={[styles.partyActionStrip, themed.panel]}>
          <View style={styles.partyVoiceWrap}>
            <VoiceControls livekit={livekit} compact enabled={settings.voiceChat} />
          </View>
          <TouchableOpacity style={[styles.actionIconBtn, themed.iconBtn]} onPress={() => setChatModal(true)}>
            <IconMark name="chat" color={palette.text} />
            {hasUnreadChat && <View style={styles.chatBadge}><Text style={styles.chatBadgeText}>{Math.min(chatMessages.length, 9)}</Text></View>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.challengeAction, themed.iconBtn]} onPress={() => setChallengeModal(true)}>
            <Text style={styles.challengeActionText}>Master</Text>
          </TouchableOpacity>
          {canShare && (
            <TouchableOpacity style={[styles.shareBoardAction, themed.blueAction]} onPress={requestShareBoard}>
              <IconMark name="share" color="#fff" />
              <Text style={styles.shareBoardText}>Share</Text>
            </TouchableOpacity>
          )}
        </View>
        {!!latestChat && chatPopupVisible && (
          <TouchableOpacity style={[styles.chatPreviewPopup, themed.card]} onPress={() => setChatModal(true)} activeOpacity={0.86}>
              <Text style={[styles.chatPreviewText, themed.bodyText]} numberOfLines={1} ellipsizeMode="tail">
                {(latestChat.player_emoji || '🙂')} {latestChat.player_name}: {latestChat.text}
              </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderWordChallengeProgress = () => {
    if (!roomId || !wordChallenge) return null;
    const isChooser = wordChallenge.chooser_player_id === playerId;
    return (
      <View style={[styles.challengeProgressPanel, themed.panel]}>
        <View style={styles.challengeProgressHeader}>
          <Text style={[styles.challengeTitle, themed.titleText]}>Word Master Challenge</Text>
          <Text style={[styles.challengeMeta, themed.mutedText]}>
            {isChooser ? 'You chose the word' : `${wordChallenge.chooser_name} chose this word`}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.challengeProgressList}>
          {wordChallenge.progress.map(item => (
            <View key={item.player_id} style={[styles.challengeChip, item.player_id === playerId && styles.challengeChipMine]}>
              <Text style={styles.challengeChipEmoji}>{item.player_emoji}</Text>
              <View style={styles.challengeChipBody}>
                <Text style={styles.challengeChipName} numberOfLines={1}>{item.player_name}</Text>
                <Text style={styles.challengeChipMeta}>{item.won ? `Solved in ${item.guesses}` : item.game_over ? 'Finished' : `${item.guesses}/${maxGuesses}`}</Text>
              </View>
              <View style={styles.challengeMiniGrid}>
                {Array.from({ length: maxGuesses }).map((_, index) => (
                  <View key={index} style={[styles.challengeMiniRow, index < item.guesses && styles.challengeMiniRowFilled, item.won && index === item.guesses - 1 && styles.challengeMiniRowWon]} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderBoard = () => (
    <View style={styles.boardShell}>
      <View style={styles.toastSlot}>{toast ? <ToastBanner message={toast.message} type={toast.type} /> : null}</View>
      {!sessionId ? (
        <View style={styles.boardLoading}>
          <ActivityIndicator size="small" color="#16C75A" />
          <Text style={[styles.boardLoadingText, themed.mutedText]}>Preparing puzzle...</Text>
        </View>
      ) : (
        <>
      {gameStatus === 'playing' && (
        <View style={styles.hintBar}>
          <TouchableOpacity
            style={[styles.hintButton, hintsUsed >= 2 && styles.hintButtonDisabled]}
            onPress={() => getHint(hintsUsed + 1)}
            disabled={hintsUsed >= 2}
          >
            <Text style={styles.hintButtonText}>Hint {Math.min(hintsUsed + 1, 2)}/2</Text>
          </TouchableOpacity>
          {hints.length > 0 && (
            <TouchableOpacity style={styles.hintTrayButton} onPress={() => setHintModal(true)} activeOpacity={0.86}>
              {hints.map((hint) => <HintPreview key={`${hint.level}-${hint.text}`} hint={hint} compact />)}
            </TouchableOpacity>
          )}
        </View>
      )}
      {roomId && (
        <View style={styles.segment}>
          <TouchableOpacity style={[styles.segmentBtn, activeBoard === 'shared' && styles.segmentActive]} onPress={() => switchBoard('shared')}>
            <Text style={[styles.segmentText, activeBoard === 'shared' && styles.segmentTextActive]}>Shared Board</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentBtn, activeBoard === 'individual' && styles.segmentActive]} onPress={() => switchBoard('individual')}>
            <Text style={[styles.segmentText, activeBoard === 'individual' && styles.segmentTextActive]}>Solo Board</Text>
          </TouchableOpacity>
          {!!wordChallenge && (
            <TouchableOpacity style={[styles.segmentBtn, activeBoard === 'challenge' && styles.segmentActive]} onPress={() => switchBoard('challenge')}>
              <Text style={[styles.segmentText, activeBoard === 'challenge' && styles.segmentTextActive]}>Word Master</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {hasShareForMe && (
        <View style={styles.prompt}>
          <Text style={styles.promptText}>{shareRequest?.from_player_name} wants to share a board.</Text>
          <View style={styles.promptRow}>
            <TouchableOpacity style={styles.acceptBtn} onPress={() => respondToShareRequest(true)}><Text style={styles.btnText}>Accept</Text></TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => respondToShareRequest(false)}><Text style={styles.ghostText}>Decline</Text></TouchableOpacity>
          </View>
        </View>
      )}
      {shareFromMe && <View style={styles.prompt}><Text style={styles.promptText}>Waiting for a friend to accept your board.</Text></View>}
      {activeBoard === 'challenge' && renderWordChallengeProgress()}
      <View
        style={styles.gridWrap}
        onLayout={(event) => {
          const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
          setGridSize({ width: nextWidth, height: nextHeight });
        }}
      >
        {roomId && typingPlayerName && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.liveCursor}>
            <Text style={styles.liveCursorEmoji}>{typingPlayerEmoji || '🙂'}</Text>
            <Text style={styles.liveCursorText}>{typingPlayerName}</Text>
          </Animated.View>
        )}
        <WordGrid
          guesses={guesses}
          results={results}
          currentGuess={currentGuess}
          wordLength={wordLength}
          invalidShake={invalidShake}
          lastSubmittedRow={lastSubmittedRow}
          maxGuesses={maxGuesses}
          maxWidth={gridSize.width}
          maxHeight={gridSize.height}
        />
      </View>
      <Keyboard onKeyPress={handleLetterPress} onEnter={handleSubmitPress} onDelete={handleDeletePress} letterStates={letterStates} />
      {roomId && <Text style={styles.typingLine}>{typingPlayerName ? `${typingPlayerName} is typing...` : activeBoard === 'challenge' ? 'Word Master board' : activeBoard === 'shared' ? 'Shared board ready' : 'Your private board'}</Text>}
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, themed.root]}>
      <View style={[styles.appFrame, themed.root, isWide && styles.appFrameWide, view === 'mode' && isWide && styles.appFrameHomeWide]}>
        {view === 'splash' && (
          <View style={[styles.screen, themed.root]}>
            <View style={styles.splashBody}>
              {renderHeroBrand()}
              <View style={styles.splashActions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setView('mode')}><Text style={styles.primaryText}>Get Started</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.outlineBtn, themed.iconBtn]} onPress={() => setHelpModal(true)}><Text style={[styles.outlineText, themed.bodyText]}>How to Play</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {view === 'mode' && (
          <ScrollView contentContainerStyle={[styles.homeScroll, !isWide && styles.homeScrollMobile]} showsVerticalScrollIndicator={false}>
            <View style={styles.homeShell}>
              <View style={[styles.homeTopBar, !isWide && styles.homeTopBarMobile]}>
                <TouchableOpacity style={styles.homeBackBtn} onPress={goBack}><Text style={styles.smallIconText}>{'<'}</Text></TouchableOpacity>
                <View style={styles.homeBrandRow}>
                  <View style={styles.homeLogoTiles}>
                    {['W', 'O', 'R', 'D'].map((letter, index) => (
                      <View key={letter} style={[styles.homeLogoTile, index === 1 ? styles.homeLogoYellow : index === 2 ? styles.homeLogoPurple : styles.homeLogoGreen]}>
                        <Text style={styles.homeLogoTileText}>{letter}</Text>
                      </View>
                    ))}
                  </View>
                  <View>
                    <Text style={styles.homeLogoName}>WORDLE</Text>
                    <Text style={styles.homeLogoSub}>Unlimited Party</Text>
                  </View>
                </View>
                <View style={styles.homeNav}>
                  <TouchableOpacity style={styles.homeNavButton} onPress={openFriends}><Text style={styles.homeNavButtonText}>Friends</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.homeNavButton} onPress={() => openLeaderboard('overall')}><Text style={styles.homeNavButtonText}>Leaderboard</Text></TouchableOpacity>
                  <Link href={'/how-to-play' as never} style={styles.homeNavLink}>How to Play</Link>
                  <Link href={'/features' as never} style={styles.homeNavLink}>Features</Link>
                </View>
              </View>

              <View style={[styles.homePanel, !isWide && styles.homePanelMobile]}>
                <View style={styles.homeHeroCopy}>
                  <Text style={styles.homeEyebrow}>Fun. Unlimited. Together.</Text>
                  <Text accessibilityRole="header" style={[styles.homeTitle, !isWide && styles.homeTitleMobile]}>Wordle Unlimited Party</Text>
                  <Text style={[styles.homeDesc, !isWide && styles.homeDescMobile]}>
                    Play your way. Challenge your mind solo, or create a party room and solve Wordle with friends in real time.
                  </Text>
                  <View style={[styles.homeActionGrid, !isWide && styles.homeActionGridMobile]}>
                    <TouchableOpacity style={[styles.homeModeCard, styles.homeSoloCard]} onPress={() => chooseMode('solo')} activeOpacity={0.86}>
                      <View style={styles.homeModeTop}>
                        <View style={styles.homeModeIcon}><Text style={styles.homeModeIconText}>♛</Text></View>
                        <Text style={styles.homeModeArrow}>→</Text>
                      </View>
                      <Text style={styles.homeModeTitle}>Solo Mode</Text>
                      <Text style={styles.homeModeDesc}>Play alone, choose difficulty, and build your streak.</Text>
                      <Text style={styles.homeModeCta}>Play Solo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.homeModeCard, styles.homeDailyCard]} onPress={chooseDailyMode} activeOpacity={0.86}>
                      <View style={styles.homeModeTop}>
                        <View style={[styles.homeModeIcon, styles.homeDailyIcon]}><Text style={styles.homeModeIconText}>D</Text></View>
                        <Text style={styles.homeModeArrow}>→</Text>
                      </View>
                      <Text style={styles.homeModeTitle}>Daily Word</Text>
                      <Text style={styles.homeModeDesc}>One global puzzle every day. Streak: {dailyStreak}</Text>
                      <Text style={[styles.homeModeCta, styles.homeDailyCta]}>Play Today</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.homeModeCard, styles.homePartyCard]} onPress={() => chooseMode('party')} activeOpacity={0.86}>
                      <View style={styles.homeModeTop}>
                        <View style={[styles.homeModeIcon, styles.homePartyIcon]}><Text style={styles.homeModeIconText}>👥</Text></View>
                        <Text style={styles.homeModeArrow}>→</Text>
                      </View>
                      <Text style={styles.homeModeTitle}>Party Mode</Text>
                      <Text style={styles.homeModeDesc}>Create or join a room with optional voice and chat.</Text>
                      <Text style={[styles.homeModeCta, styles.homePartyCta]}>Create / Join</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.homeModeCard, styles.homeChallengeCard]} onPress={() => chooseMode('party')} activeOpacity={0.86}>
                      <View style={styles.homeModeTop}>
                        <View style={[styles.homeModeIcon, styles.homeChallengeIcon]}><Text style={styles.homeModeIconText}>W</Text></View>
                        <Text style={styles.homeModeArrow}>â†’</Text>
                      </View>
                      <Text style={styles.homeModeTitle}>Word Master Challenge</Text>
                      <Text style={styles.homeModeDesc}>Pick a valid word and watch friends race through their boards.</Text>
                      <Text style={[styles.homeModeCta, styles.homeChallengeCta]}>Start in Party</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {isWide && (
                  <View style={styles.homeArtCard}>
                    <Image source={{ uri: '/party-illustration.png' }} style={styles.homeArtImage} resizeMode="cover" />
                    <View style={styles.homeArtBadge}><Text style={styles.homeArtBadgeText}>Live party rooms</Text></View>
                  </View>
                )}
              </View>

              <View style={styles.homeFeatureStrip}>
                <TouchableOpacity style={styles.homeFeature} onPress={() => openLeaderboard('overall')} activeOpacity={0.86}><Text style={styles.homeFeatureIcon}>🏆</Text><Text style={styles.homeFeatureTitle}>Leaderboard</Text><Text style={styles.homeFeatureText}>Top players</Text></TouchableOpacity>
                <View style={styles.homeFeature}><Text style={styles.homeFeatureIcon}>∞</Text><Text style={styles.homeFeatureTitle}>Unlimited Puzzles</Text><Text style={styles.homeFeatureText}>Endless fun</Text></View>
                <View style={styles.homeFeature}><Text style={styles.homeFeatureIcon}>🎙️</Text><Text style={styles.homeFeatureTitle}>Live Voice Chat</Text><Text style={styles.homeFeatureText}>Optional</Text></View>
                <View style={styles.homeFeature}><Text style={styles.homeFeatureIcon}>👥</Text><Text style={styles.homeFeatureTitle}>Multiple Rooms</Text><Text style={styles.homeFeatureText}>Invite friends</Text></View>
                <View style={styles.homeFeature}><Text style={styles.homeFeatureIcon}>💡</Text><Text style={styles.homeFeatureTitle}>Smart Hints</Text><Text style={styles.homeFeatureText}>Use wisely</Text></View>
              </View>

              <View style={styles.homeSeoGrid}>
                <View style={styles.homeSeoPanel}>
                  <Text style={styles.seoTitle}>How to Play</Text>
                  <Text style={styles.seoText}>
                    Guess the hidden five-letter word. Green letters are correct, yellow letters are in the word but placed differently, and dark letters are not in the answer.
                  </Text>
                  <Link href={'/how-to-play' as never} style={styles.homeReadMore}>Read the guide →</Link>
                </View>
                <View style={styles.homeSeoPanel}>
                  <Text style={styles.seoTitle}>Why players use it</Text>
                  <Text style={styles.seoText}>
                    Unlimited puzzles, multiplayer Wordle rooms, shareable invite links, useful hints, answer meanings, statistics, and mobile-friendly gameplay.
                  </Text>
                  <Link href={'/features' as never} style={styles.homeReadMore}>Explore features →</Link>
                </View>
              </View>

              <View style={styles.homeFooterLinks}>
                <Link href={'/privacy' as never} style={styles.seoLink}>Privacy</Link>
                <Link href={'/terms' as never} style={styles.seoLink}>Terms</Link>
              </View>
            </View>
          </ScrollView>
        )}

        {view === 'difficulty' && (
          <ScrollView contentContainerStyle={styles.scrollScreen} showsVerticalScrollIndicator={false}>
            {renderTopBar('Select Difficulty', 'Choose your challenge')}
            <View style={styles.difficultyList}>
              {Object.entries(DIFF_META).map(([key, meta]) => (
                <TouchableOpacity key={key} style={[styles.diffCard, difficulty === key && { borderColor: meta.color }]} onPress={() => startSelectedDifficulty(key)}>
                  <View style={[styles.diffBadge, { backgroundColor: meta.color }]}><Text style={styles.diffBadgeText}>{meta.mark}</Text></View>
                  <View style={styles.diffTextWrap}>
                    <Text style={styles.diffTitle}>{meta.label}</Text>
                    <Text style={styles.diffDesc}>{meta.desc}</Text>
                  </View>
                  <Text style={styles.diffGuesses}>{meta.guesses}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}

        {view === 'party' && !roomId && (
          <ScrollView contentContainerStyle={styles.scrollScreen} showsVerticalScrollIndicator={false}>
            {renderTopBar('Start a Party', 'Create or join a room')}
            <Text style={[styles.inputLabel, themed.subtleText]}>Playing as</Text>
            {leaderboardProfile ? (
              <View style={[styles.profileDisplay, themed.panel]}>
                <Text style={styles.profileDisplayEmoji}>{leaderboardProfile.emoji || selectedEmoji}</Text>
                <View style={styles.socialInfo}>
                  <Text style={[styles.socialName, themed.titleText]}>{leaderboardProfile.username}</Text>
                  <Text style={[styles.socialMeta, themed.mutedText]}>Leaderboard username</Text>
                </View>
              </View>
            ) : (
              <TextInput
                value={roomName}
                onChangeText={(value) => { setRoomName(value); if (nameError) setNameError(''); }}
                placeholder=""
                placeholderTextColor="#64748B"
                style={[styles.input, themed.input, nameError && styles.inputError]}
                autoCorrect={false}
              />
            )}
            {!!nameError && <Text style={styles.fieldError}>{nameError}</Text>}
            <Text style={[styles.inputLabel, themed.subtleText]}>Profile emoji</Text>
            <TouchableOpacity style={[styles.emojiPickerButton, themed.panel]} onPress={() => setEmojiModal(true)}>
              <Text style={styles.emojiPickerButtonText}>{selectedEmoji}</Text>
              <Text style={[styles.emojiPickerLabel, themed.subtleText]}>Choose profile emoji</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, styles.createPartyBtn]} onPress={createParty}><Text style={styles.primaryText}>Create Party</Text></TouchableOpacity>
            <View style={styles.divider}><View style={styles.line} /><Text style={styles.dividerText}>or join a room</Text><View style={styles.line} /></View>
            <Text style={[styles.inputLabel, themed.subtleText]}>Room code</Text>
            <View style={styles.joinRow}>
              <TextInput
                value={joinCode}
                onChangeText={value => setJoinCode(value.toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor="#64748B"
                style={[styles.input, styles.joinInput, themed.input]}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
              />
              <TouchableOpacity style={styles.joinBtn} onPress={joinParty}><Text style={styles.primaryText}>Join</Text></TouchableOpacity>
            </View>
            <View style={[styles.recentBox, themed.panel]}>
              <Text style={[styles.recentTitle, themed.titleText]}>Recent rooms</Text>
              {recentRooms.length === 0 ? (
                <Text style={styles.recentEmpty}>Rooms you join will appear here later.</Text>
              ) : recentRooms.map(room => (
                <TouchableOpacity key={room.roomId} style={[styles.recentRow, themed.card]} onPress={() => chooseRecentRoom(room)}>
                  <Text style={[styles.recentCode, themed.titleText]}>{room.roomId}</Text>
                  <Text style={[styles.recentMeta, themed.mutedText]}>{room.name}</Text>
                </TouchableOpacity>
              ))}
              {!!recentWarning && <Text style={styles.fieldError}>{recentWarning}</Text>}
            </View>
          </ScrollView>
        )}

        {view === 'roomCreated' && roomId && (
          <View style={styles.screen}>
            {renderTopBar('Room Created', 'Share this code')}
            <View style={styles.createdBody}>
              <Text style={styles.pageTitle}>Room Created!</Text>
              <Text style={styles.pageSub}>Share this code with your friends</Text>
              <View style={styles.createdCodeBox}><Text style={styles.createdCode}>{roomId}</Text></View>
              <View style={styles.inviteActions}>
                <TouchableOpacity style={styles.inviteBtn} onPress={copyRoom}><Text style={styles.copyLabel}>Copy Code</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.inviteBtn, styles.shareBtn]} onPress={shareRoom}><Text style={styles.shareLabel}>Share Link</Text></TouchableOpacity>
              </View>
              <Text style={styles.waitingText}>Friends can join any time. No waiting room needed.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setView('party')}><Text style={styles.primaryText}>Continue to Game</Text></TouchableOpacity>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => { leaveRoom(); setView('mode'); }}><Text style={styles.outlineText}>Cancel Room</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {view === 'solo' && (
          <View style={[styles.gameScreen, themed.root]}>
            {renderTopBar('Solo Game', activeMeta.label)}
            {renderBoard()}
          </View>
        )}

        {view === 'party' && roomId && (
          <View style={[styles.gameScreen, themed.root]}>
            {renderTopBar(`Room ${roomId}`, roomSubtitle, true)}
            {renderPartyActions()}
            <View style={[styles.playerStrip, isShort && styles.playerStripCompact]}>
              {roomPlayers.slice(0, isShort ? 6 : 4).map((player, index) => (
                <View key={player.player_id} style={[styles.playerChip, isShort && styles.playerChipCompact]}>
                  <View style={[styles.avatarDot, index === 0 && styles.ownerDot]}><Text style={styles.avatarEmoji}>{player.player_emoji || '🙂'}</Text></View>
                  {!isShort && <Text style={styles.playerChipText} numberOfLines={1}>{player.player_name}</Text>}
                  <View style={styles.onlineDot} />
                </View>
              ))}
            </View>
            {renderBoard()}
          </View>
        )}
      </View>

      <Modal visible={diffModal} transparent animationType="slide" onRequestClose={() => setDiffModal(false)}>
        <TouchableWithoutFeedback onPress={() => setDiffModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Difficulty</Text>
          {Object.entries(DIFF_META).map(([d, m]) => (
            <TouchableOpacity
              key={d}
              style={[styles.sheetRow, difficulty === d && { borderColor: m.color }]}
              onPress={() => changeDifficulty(d)}
            >
              <Text style={[styles.sheetRowTitle, difficulty === d && { color: m.color }]}>{m.label}</Text>
              <Text style={styles.sheetRowMeta}>{m.desc} - {m.guesses}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <Modal visible={roomModal} transparent animationType="slide" onRequestClose={() => setRoomModal(false)}>
        <TouchableWithoutFeedback onPress={() => setRoomModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Room Info</Text>
          <View style={styles.infoGrid}>
            <InfoRow label="Room code" value={roomId || '-'} />
            <InfoRow label="Difficulty" value={activeMeta.label} />
            <InfoRow label="Players" value={`${roomPlayers.length || 1}/8`} />
          </View>
          <View style={styles.inviteCard}>
            <Text style={styles.copyCode}>{roomId}</Text>
            <View style={styles.inviteActions}>
              <TouchableOpacity style={styles.inviteBtn} onPress={copyRoom}><Text style={styles.copyLabel}>Copy Link</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.inviteBtn, styles.shareBtn]} onPress={shareRoom}><Text style={styles.shareLabel}>Share</Text></TouchableOpacity>
            </View>
          </View>
          <View style={styles.playerList}>
            {roomPlayers.map(player => (
              <View key={player.player_id} style={styles.playerRow}>
                <View style={styles.avatarDot}><Text style={styles.avatarEmoji}>{player.player_emoji || '🙂'}</Text></View>
                <Text style={styles.playerName}>{player.player_name}{player.player_id === playerId ? ' (You)' : ''}</Text>
                <View style={styles.onlineDot} />
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.dangerBtn} onPress={() => { leaveRoom(); setRoomModal(false); setView('mode'); }}><Text style={styles.dangerText}>Leave Room</Text></TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={challengeModal} transparent animationType="slide" onRequestClose={() => setChallengeModal(false)}>
        <TouchableWithoutFeedback onPress={() => setChallengeModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Word Master Challenge</Text>
              <Text style={styles.helpText}>Choose one official answer word for friends to solve.</Text>
            </View>
            <TouchableOpacity style={styles.closeIconBtn} onPress={() => setChallengeModal(false)}><IconMark name="x" color={palette.text} /></TouchableOpacity>
          </View>
          <TextInput
            value={challengeWord}
            onChangeText={(text) => {
              setChallengeWord(text.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5));
              setChallengeError('');
            }}
            maxLength={5}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="CRANE"
            placeholderTextColor="#64748B"
            style={styles.challengeInput}
          />
          {!!challengeError && <Text style={styles.fieldError}>{challengeError}</Text>}
          <Text style={styles.challengeHint}>Friends get your word. You get a private server word so everyone can play in the same round.</Text>
          <TouchableOpacity style={[styles.primaryBtn, challengeWord.length !== 5 && styles.disabledBtn]} disabled={challengeWord.length !== 5} onPress={startWordMasterChallenge}>
            <Text style={styles.primaryText}>Start Challenge</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={friendsModal} transparent animationType="slide" onRequestClose={() => setFriendsModal(false)}>
        <TouchableWithoutFeedback onPress={() => setFriendsModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Friends</Text>
              <Text style={styles.helpText}>Add friends by username and invite online friends.</Text>
            </View>
            <TouchableOpacity style={styles.closeIconBtn} onPress={() => setFriendsModal(false)}><IconMark name="x" color={palette.text} /></TouchableOpacity>
          </View>

          <ScrollView style={styles.friendsScroll} showsVerticalScrollIndicator={false}>
          {!!friendsState?.party_invites?.length && (
            <View style={styles.socialSection}>
              <Text style={styles.socialSectionTitle}>Party Invites</Text>
              {friendsState.party_invites.map(invite => (
                <View key={invite.invite_id} style={styles.socialRow}>
                  <Text style={styles.socialAvatar}>{invite.from_player.emoji}</Text>
                  <View style={styles.socialInfo}>
                    <Text style={styles.socialName} numberOfLines={1}>{invite.from_player.username}</Text>
                    <Text style={styles.socialMeta}>Room {invite.room_id}</Text>
                  </View>
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptPartyInvite(invite.invite_id, invite.room_id)}><Text style={styles.acceptText}>Join</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.declineBtn} onPress={() => respondPartyInvite(invite.invite_id, false)}><Text style={styles.declineText}>No</Text></TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {!!friendsState?.incoming_requests?.length && (
            <View style={styles.socialSection}>
              <Text style={styles.socialSectionTitle}>Friend Requests</Text>
              {friendsState.incoming_requests.map(request => request.from_player && (
                <View key={request.request_id} style={styles.socialRow}>
                  <Text style={styles.socialAvatar}>{request.from_player.emoji}</Text>
                  <View style={styles.socialInfo}>
                    <Text style={styles.socialName} numberOfLines={1}>{request.from_player.username}</Text>
                    <Text style={styles.socialMeta}>wants to be friends</Text>
                  </View>
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => respondFriendRequest(request.request_id, true)}><Text style={styles.acceptText}>Accept</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.declineBtn} onPress={() => respondFriendRequest(request.request_id, false)}><Text style={styles.declineText}>No</Text></TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.socialSection}>
            <Text style={styles.socialSectionTitle}>Find Players</Text>
            <TextInput style={styles.input} value={friendSearch} onChangeText={setFriendSearch} placeholder="Search username" placeholderTextColor="#64748B" autoCapitalize="none" />
            {friendSearching && <ActivityIndicator color="#16C75A" />}
            {friendResults.map(player => {
              const alreadyFriend = friendsState?.friends.some(friend => friend.user_id === player.user_id);
              const alreadyRequested = friendsState?.outgoing_requests.some(request => request.to_player?.user_id === player.user_id);
              return (
                <View key={player.user_id} style={styles.socialRow}>
                  <TouchableOpacity onPress={() => openPlayerProfile(player)}><Text style={styles.socialAvatar}>{player.emoji}</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.socialInfo} onPress={() => openPlayerProfile(player)}>
                    <Text style={styles.socialName} numberOfLines={1}>{player.username}</Text>
                    <Text style={styles.socialMeta}>{alreadyFriend ? 'Already friends' : alreadyRequested ? 'Request sent' : 'Leaderboard player'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={alreadyFriend || alreadyRequested} style={[styles.acceptBtn, (alreadyFriend || alreadyRequested) && styles.disabledBtn]} onPress={() => sendFriendRequest(player.user_id)}>
                    <Text style={styles.acceptText}>{alreadyFriend ? 'Added' : alreadyRequested ? 'Sent' : 'Add'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={styles.socialSection}>
            <Text style={styles.socialSectionTitle}>Friends List</Text>
            {friendsState?.friends?.length ? friendsState.friends.map((friend: FriendPlayer) => (
              <View key={friend.user_id} style={[styles.friendRowWrap, openFriendMenuId === friend.user_id && styles.friendRowWrapOpen]}>
                <View style={styles.socialRow}>
                  <TouchableOpacity onPress={() => openPlayerProfile(friend)}><Text style={styles.socialAvatar}>{friend.emoji}</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.socialInfo} onPress={() => openPlayerProfile(friend)}>
                    <Text style={styles.socialName} numberOfLines={1}>{friend.username}</Text>
                    <Text style={styles.socialMeta}>{friend.online ? friend.status || 'online' : 'offline'}</Text>
                  </TouchableOpacity>
                  <View style={[styles.onlineDot, friend.online ? styles.onlineDotActive : styles.onlineDotMuted]} />
                  <TouchableOpacity style={styles.friendDotsBtn} onPress={() => setOpenFriendMenuId(openFriendMenuId === friend.user_id ? null : friend.user_id)}>
                    <IconMark name="dots" color="#F8FAFC" />
                  </TouchableOpacity>
                </View>
                {openFriendMenuId === friend.user_id && (
                  <View style={styles.friendMenu}>
                    <TouchableOpacity style={styles.friendMenuBtn} onPress={() => { setOpenFriendMenuId(null); openPlayerProfile(friend); }}><Text style={styles.friendMenuText}>Stats</Text></TouchableOpacity>
                    <TouchableOpacity disabled={!friend.online || !(roomId || sessionId) || pendingInviteUserId === friend.user_id} style={[styles.friendMenuBtn, (!friend.online || !(roomId || sessionId) || pendingInviteUserId === friend.user_id) && styles.disabledBtn]} onPress={() => sendInviteToFriend(friend.user_id)}>
                      <Text style={styles.friendMenuText}>{pendingInviteUserId === friend.user_id ? 'Pending' : 'Invite'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.friendMenuBtn, styles.friendRemoveBtn]} onPress={() => { setOpenFriendMenuId(null); removeFriend(friend.user_id); }}><Text style={styles.friendRemoveText}>Remove</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            )) : (
              <Text style={styles.emptySocialText}>No friends yet. Search a username to add someone.</Text>
            )}
          </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!pendingPartyInvite} transparent animationType="fade" onRequestClose={clearPendingPartyInvite}>
        <TouchableWithoutFeedback onPress={clearPendingPartyInvite}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        {pendingPartyInvite && (
          <View style={styles.invitePopup}>
            <Text style={styles.socialAvatar}>{pendingPartyInvite.from_player.emoji}</Text>
            <Text style={styles.sheetTitle}>{pendingPartyInvite.from_player.username} invited you</Text>
            <Text style={styles.helpText}>Join party room {pendingPartyInvite.room_id}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => acceptPartyInvite(pendingPartyInvite.invite_id, pendingPartyInvite.room_id)}><Text style={styles.primaryText}>Join Party</Text></TouchableOpacity>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => { respondPartyInvite(pendingPartyInvite.invite_id, false); clearPendingPartyInvite(); }}><Text style={styles.outlineText}>Decline</Text></TouchableOpacity>
          </View>
        )}
      </Modal>

      <Modal visible={helpModal} transparent animationType="fade" onRequestClose={() => setHelpModal(false)}>
        <View style={styles.centerModal}>
          <View style={styles.helpCard}>
            <Text style={styles.sheetTitle}>How to Play</Text>
            <View style={styles.exampleWord}>
              {['W', 'O', 'R', 'D', 'E'].map((letter, index) => (
                <View key={letter} style={[styles.exampleTile, index === 0 && styles.exampleGreen, index === 2 && styles.exampleYellow, index > 2 && styles.exampleGray]}>
                  <Text style={styles.exampleLetter}>{letter}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.helpText}>Green means correct place, yellow means wrong place, gray means not in the word.</Text>
            <Text style={styles.helpText}>Solo is private. Party keeps the room alive so friends can talk and play shared or individual boards.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setHelpModal(false)}><Text style={styles.primaryText}>Got It</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={statsModal} transparent animationType="slide" onRequestClose={() => setStatsModal(false)}>
        <View style={styles.centerModal}>
          <View style={styles.helpCard}>
            <Text style={styles.sheetTitle}>Statistics</Text>
            <StatsSummary stats={stats} activeTab={statsTab} onTabChange={setStatsTab} gameStatus={gameStatus} guesses={guesses} />
            <TouchableOpacity style={styles.inlineAction} onPress={() => { setStatsModal(false); openLeaderboard('overall'); }}><Text style={styles.inlineActionText}>Open Leaderboard</Text></TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStatsModal(false)}><Text style={styles.primaryText}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={profileModal} transparent animationType="fade" onRequestClose={() => setProfileModal(false)}>
        <View style={styles.centerModal}>
          <View style={[styles.menuCard, themed.card]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, themed.titleText]}>Choose Username</Text>
              <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setProfileModal(false)}>
                <IconMark name="x" color={palette.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.helpText, themed.subtleText]}>Pick one public username for leaderboard rankings. It is saved on this device.</Text>
            <TouchableOpacity style={styles.emojiPickerButton} onPress={() => setEmojiModal(true)}>
              <Text style={styles.emojiPickerButtonText}>{selectedEmoji}</Text>
              <Text style={styles.emojiPickerLabel}>Change emoji</Text>
            </TouchableOpacity>
            <TextInput
              value={usernameInput}
              onChangeText={(value) => { setUsernameInput(value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16)); setUsernameStatus(''); }}
              placeholder="unique_username"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              style={[styles.input, themed.input]}
            />
            {!!usernameStatus && <Text style={styles.fieldError}>{usernameStatus}</Text>}
            <TouchableOpacity style={styles.primaryBtn} onPress={saveLeaderboardProfile}><Text style={styles.primaryText}>Save Username</Text></TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setProfileModal(false)}><Text style={styles.ghostText}>Continue as Guest</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={leaderboardModal} transparent animationType="slide" onRequestClose={() => setLeaderboardModal(false)}>
        <View style={styles.centerModal}>
          <View style={[styles.leaderboardCard, themed.card]}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetTitle, themed.titleText]}>Leaderboard</Text>
                <Text style={[styles.topSubtitle, themed.mutedText]}>
                  {leaderboardPeriod === 'weekly'
                    ? `This week${leaderboardData?.resets_at ? ` · resets ${formatShortDate(leaderboardData.resets_at)}` : ''}`
                    : 'All-time rankings'}
                </Text>
              </View>
              <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setLeaderboardModal(false)}>
                <IconMark name="x" color={palette.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.periodToggle}>
              {(['weekly', 'all_time'] as LeaderboardPeriod[]).map(period => (
                <TouchableOpacity key={period} style={[styles.periodPill, leaderboardPeriod === period && styles.periodPillActive]} onPress={() => selectLeaderboardPeriod(period)}>
                  <Text style={[styles.periodPillText, leaderboardPeriod === period && styles.periodPillTextActive]}>{period === 'weekly' ? 'This Week' : 'All Time'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.leaderboardTabs}>
              {(['overall', 'easy', 'moderate', 'difficult', 'prodigy', 'rules'] as LeaderboardTab[]).map(tab => (
                <TouchableOpacity key={tab} style={[styles.leaderboardTab, leaderboardTab === tab && styles.leaderboardTabActive]} onPress={() => { setLeaderboardTab(tab); if (tab !== 'rules') refreshLeaderboard(tab, leaderboardPeriod); }}>
                  <Text style={[styles.leaderboardTabText, leaderboardTab === tab && styles.leaderboardTabTextActive]}>{tab}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {leaderboardTab === 'rules' ? (
              <View style={styles.rulesBox}>
                <Text style={styles.ruleTitle}>Scoring Rules</Text>
                <Text style={styles.ruleText}>Easy win: 100 points</Text>
                <Text style={styles.ruleText}>Moderate win: 140 points</Text>
                <Text style={styles.ruleText}>Difficult win: 180 points</Text>
                <Text style={styles.ruleText}>Prodigy win: 250 points</Text>
                <Text style={styles.ruleText}>Efficiency bonus: 10 × remaining guesses</Text>
                <Text style={styles.ruleText}>No-hint bonus: +15</Text>
                <Text style={styles.ruleText}>Hint penalty: -10 × hints used</Text>
                <Text style={styles.ruleExample}>Example: Easy win in 4 guesses with no hints = 100 + 20 + 15 = 135.</Text>
              </View>
            ) : leaderboardLoading ? (
              <View style={styles.boardLoading}><ActivityIndicator color="#16C75A" /><Text style={styles.boardLoadingText}>Loading rankings...</Text></View>
            ) : (
              <ScrollView style={styles.leaderboardList} contentContainerStyle={styles.leaderboardListContent}>
                {leaderboardData?.current_user && !leaderboardData.entries.some(entry => entry.user_id === leaderboardData.current_user?.user_id) && (
                  <LeaderboardRow entry={leaderboardData.current_user} current onPress={openPublicProfile} />
                )}
                {(leaderboardData?.entries ?? []).map(entry => (
                  <LeaderboardRow key={entry.user_id} entry={entry} current={entry.user_id === leaderboardProfile?.user_id} onPress={openPublicProfile} />
                ))}
                {!leaderboardData?.entries?.length && <Text style={styles.hintEmptyText}>No ranked games yet. Finish a puzzle to appear here.</Text>}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={publicProfileModal} transparent animationType="slide" onRequestClose={() => setPublicProfileModal(false)}>
        <View style={styles.centerModal}>
          <View style={[styles.publicProfileCard, themed.card]}>
            <View style={styles.sheetHeader}>
              <View style={styles.publicProfileHeader}>
                <Text style={styles.publicProfileEmoji}>{publicProfile?.player.emoji || '🙂'}</Text>
                <View>
                  <Text style={[styles.sheetTitle, themed.titleText]}>{publicProfile?.player.username || 'Loading player'}</Text>
                  <Text style={[styles.topSubtitle, themed.mutedText]}>
                    Week #{publicProfile?.ranks.weekly ?? '-'} · All-time #{publicProfile?.ranks.all_time ?? '-'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setPublicProfileModal(false)}>
                <IconMark name="x" color={palette.text} />
              </TouchableOpacity>
            </View>
            {publicProfileLoading ? (
              <View style={styles.boardLoading}><ActivityIndicator color="#16C75A" /><Text style={styles.boardLoadingText}>Loading profile...</Text></View>
            ) : publicProfile ? (
              <ScrollView style={styles.publicProfileScroll} contentContainerStyle={styles.publicProfileContent}>
                {publicProfile.player.user_id !== leaderboardProfile?.user_id && (
                  <View style={styles.profileActions}>
                    {isFriend(publicProfile.player.user_id) ? (
                      <>
                        <TouchableOpacity disabled={!selectedProfileFriend?.online || !(roomId || sessionId) || pendingInviteUserId === publicProfile.player.user_id} style={[styles.inlineAction, (!selectedProfileFriend?.online || !(roomId || sessionId) || pendingInviteUserId === publicProfile.player.user_id) && styles.disabledBtn]} onPress={() => sendInviteToFriend(publicProfile.player.user_id)}>
                          <Text style={styles.inlineActionText}>{pendingInviteUserId === publicProfile.player.user_id ? 'Pending Invite' : 'Invite / Request Board'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.declineBtn} onPress={() => removeFriend(publicProfile.player.user_id)}><Text style={styles.declineText}>Remove Friend</Text></TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity disabled={hasOutgoingFriendRequest(publicProfile.player.user_id)} style={[styles.primaryBtn, hasOutgoingFriendRequest(publicProfile.player.user_id) && styles.disabledBtn]} onPress={() => sendFriendRequest(publicProfile.player.user_id)}>
                        <Text style={styles.primaryText}>{hasOutgoingFriendRequest(publicProfile.player.user_id) ? 'Request Sent' : 'Add Friend'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                <View style={styles.leaderboardTabs}>
                  {(['overall', 'easy', 'moderate', 'difficult', 'prodigy'] as StatsTab[]).map(tab => (
                    <TouchableOpacity key={tab} style={[styles.leaderboardTab, publicProfileTab === tab && styles.leaderboardTabActive]} onPress={() => setPublicProfileTab(tab)}>
                      <Text style={[styles.leaderboardTabText, publicProfileTab === tab && styles.leaderboardTabTextActive]}>{tab}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <PublicStatsPanel stats={publicProfile.all_time[publicProfileTab]} weeklyStats={publicProfile.weekly[publicProfileTab]} />
                <Text style={styles.achievementSectionTitle}>Achievements</Text>
                <View style={styles.achievementList}>
                  {publicProfile.achievements.map(item => <AchievementCard key={item.id} item={item} />)}
                </View>
              </ScrollView>
            ) : (
              <Text style={styles.hintEmptyText}>Profile stats are not available yet. Try again after the backend finishes redeploying.</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={settingsModal} transparent animationType="fade" onRequestClose={() => setSettingsModal(false)}>
        <View style={styles.centerModal}>
          <View style={[styles.menuCard, themed.card]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, themed.titleText]}>Settings</Text>
              <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setSettingsModal(false)}>
                <IconMark name="x" color={palette.text} />
              </TouchableOpacity>
            </View>
            <SettingToggle label="Sound Effects" value={settings.sound} onPress={() => updateSetting('sound', !settings.sound)} />
            <SettingToggle
              label="Vibration"
              value={settings.vibration && supportsVibration}
              disabled={!supportsVibration}
              note={!supportsVibration ? 'Not supported on this device/browser' : undefined}
              onPress={() => supportsVibration && updateSetting('vibration', !settings.vibration)}
            />
            <SettingToggle label="Voice Chat" value={settings.voiceChat} onPress={() => updateSetting('voiceChat', !settings.voiceChat)} />
            <View style={styles.settingRow}>
              <Text style={styles.menuText}>Theme</Text>
              <View style={styles.themeToggle}>
                {(['dark', 'light'] as const).map(mode => (
                  <TouchableOpacity key={mode} style={[styles.themePill, settings.theme === mode && styles.themePillActive]} onPress={() => updateSetting('theme', mode)}>
                    <Text style={[styles.themePillText, settings.theme === mode && styles.themePillTextActive]}>{mode}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.menuText}>Default Difficulty</Text>
              <View style={styles.settingOptions}>
                {Object.entries(DIFF_META).map(([key, meta]) => (
                  <TouchableOpacity key={key} style={[styles.settingPill, settings.defaultDifficulty === key && { borderColor: meta.color }]} onPress={() => updateSetting('defaultDifficulty', key)}>
                    <Text style={[styles.settingPillText, settings.defaultDifficulty === key && { color: meta.color }]}>{meta.mark}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setHelpModal(true); setSettingsModal(false); }}><Text style={styles.menuText}>How to Play</Text><Text style={styles.chevron}>{'>'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setStatsModal(true); setSettingsModal(false); }}><Text style={styles.menuText}>Statistics</Text><Text style={styles.chevron}>{'>'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setSettingsModal(false); openLeaderboard('overall'); }}><Text style={styles.menuText}>Leaderboard</Text><Text style={styles.chevron}>{'>'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuRow}><Text style={styles.menuText}>Achievements</Text><Text style={styles.menuMuted}>Soon</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={emojiModal} transparent animationType="slide" onRequestClose={() => setEmojiModal(false)}>
        <TouchableWithoutFeedback onPress={() => setEmojiModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={[styles.sheet, themed.card]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, themed.titleText]}>Choose Emoji</Text>
            <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setEmojiModal(false)}>
              <IconMark name="x" color={palette.text} />
            </TouchableOpacity>
          </View>
          {EMOJI_GROUPS.map((group, index) => (
            <View key={index} style={styles.emojiGroup}>
              {group.map(emoji => (
                <TouchableOpacity key={emoji} style={[styles.emojiOptionLarge, selectedEmoji === emoji && styles.emojiOptionActive]} onPress={() => { setSelectedEmoji(emoji); setEmojiModal(false); }}>
                  <Text style={styles.emojiOptionLargeText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      </Modal>

      <Modal visible={chatModal} transparent animationType="slide" onRequestClose={() => setChatModal(false)}>
        <TouchableWithoutFeedback onPress={() => setChatModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={[styles.sheet, themed.card]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, themed.titleText]}>Room Chat</Text>
            <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setChatModal(false)}>
              <IconMark name="x" color={palette.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.chatList} contentContainerStyle={styles.chatListContent}>
            {chatMessages.length === 0 ? (
              <Text style={[styles.recentEmpty, themed.mutedText]}>No messages yet.</Text>
            ) : chatMessages.map(message => (
              <ChatBubble key={message.message_id} message={message} mine={message.player_id === playerId} />
            ))}
          </ScrollView>
          <View style={styles.quickChatRow}>
            {QUICK_CHATS.map(text => (
              <TouchableOpacity key={text} style={[styles.quickChatPill, themed.iconBtn]} onPress={() => sendChat(text)}>
                <Text style={[styles.quickChatText, themed.bodyText]}>{text}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.chatInputRow}>
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Message room"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.chatInput, themed.input]}
              maxLength={180}
            />
            <TouchableOpacity style={styles.chatSendBtn} onPress={() => sendChat(chatInput)}>
              <IconMark name="send" color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={hintModal} transparent animationType="slide" onRequestClose={() => setHintModal(false)}>
        <TouchableWithoutFeedback onPress={() => setHintModal(false)}><View style={styles.modalBackdrop} /></TouchableWithoutFeedback>
        <View style={[styles.sheet, themed.card]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, themed.titleText]}>Puzzle Clues</Text>
            <TouchableOpacity style={[styles.closeIconBtn, themed.iconBtn]} onPress={() => setHintModal(false)}>
              <IconMark name="x" color={palette.text} />
            </TouchableOpacity>
          </View>
          {hints.length ? hints.map((hint) => <HintFullCard key={`${hint.level}-${hint.text}`} hint={hint} />) : (
            <Text style={[styles.hintEmptyText, themed.bodyText]}>No clues revealed yet.</Text>
          )}
        </View>
      </Modal>

      {showResultOverlay && gameStatus !== 'playing' && (view === 'solo' || (view === 'party' && roomId)) && (
        <View style={styles.overlay}>
          <View style={styles.resultCard}>
            <View style={styles.logoMarkSmall}><Text style={styles.logoMarkText}>W</Text></View>
            <Text style={[styles.resultTitle, gameStatus === 'won' ? styles.win : styles.loss]}>{gameStatus === 'won' ? 'You Win!' : 'Game Over'}</Text>
            {dailyDate && <Text style={styles.hintAssistedText}>Daily streak: {dailyStreak}</Text>}
            {answer && <Text style={styles.answerText}>{gameStatus === 'won' ? `The word was ${answer}` : `The word was ${answer}`}</Text>}
            {hintsUsed > 0 && <Text style={styles.hintAssistedText}>Hint-assisted</Text>}
            {answerInfo && <AnswerMeaningCard info={answerInfo} />}
            <StatsSummary stats={stats} activeTab="overall" gameStatus={gameStatus} guesses={guesses} compact />
            <TouchableOpacity style={styles.inlineAction} onPress={() => openLeaderboard('overall')}><Text style={styles.inlineActionText}>View Leaderboard</Text></TouchableOpacity>
            {roomId ? (
              <>
                <TouchableOpacity style={styles.primaryBtn} onPress={createSharedGame}><Text style={styles.primaryText}>Continue Together</Text></TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={createIndividualGame}><Text style={styles.outlineText}>Play Individually</Text></TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => startGame(dailyDate ? 'easy' : difficulty)}><Text style={styles.primaryText}>{dailyDate ? 'Play Unlimited' : 'Play Again'}</Text></TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const AnswerMeaningCard: React.FC<{ info: AnswerInfo }> = ({ info }) => (
  <View style={styles.meaningCard}>
    <Text style={styles.meaningWord}>{info.word}</Text>
    {!!info.part_of_speech && <Text style={styles.meaningPos}>{info.part_of_speech}</Text>}
    <Text style={styles.meaningDefinition}>{info.definition}</Text>
    {!!info.example && <Text style={styles.meaningExample}>{info.example}</Text>}
  </View>
);

const HintPreview: React.FC<{ hint: HintState; compact?: boolean }> = ({ hint, compact = false }) => {
  if (hint.kind === 'letter' && hint.revealed_position && hint.revealed_letter) {
    return (
      <View style={[styles.hintLetterPill, compact && styles.hintPreviewChip]}>
        <Text style={styles.hintLetterLabel}>{ordinal(hint.revealed_position)} letter</Text>
        <Text style={styles.hintLetterValue}>{hint.revealed_letter}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.hintTextChip, compact && styles.hintPreviewChip]}>
      <Text style={styles.hintChipKicker}>Hint {hint.level}</Text>
      <Text style={styles.hintInlineText} numberOfLines={1} ellipsizeMode="tail">
        {hint.text}
      </Text>
    </View>
  );
};

const HintFullCard: React.FC<{ hint: HintState }> = ({ hint }) => (
  <View style={styles.hintFullCard}>
    <View style={styles.hintFullHeader}>
      <Text style={styles.hintFullKicker}>Hint {hint.level}</Text>
      {hint.kind === 'letter' && hint.revealed_position && hint.revealed_letter ? (
        <View style={styles.hintFullLetterBadge}>
          <Text style={styles.hintFullLetterBadgeText}>{ordinal(hint.revealed_position)}: {hint.revealed_letter}</Text>
        </View>
      ) : null}
    </View>
    <Text style={styles.hintFullText}>{hint.text}</Text>
  </View>
);

const ordinal = (value: number) => {
  if (value % 100 >= 10 && value % 100 <= 20) return `${value}th`;
  const suffix = value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
};

const ChatBubble: React.FC<{ message: ChatMessage; mine: boolean }> = ({ message, mine }) => (
  <View style={[styles.chatBubble, mine && styles.chatBubbleMine]}>
    <Text style={styles.chatAuthor}>{message.player_emoji || '🙂'} {message.player_name}</Text>
    <Text style={styles.chatText}>{message.text}</Text>
  </View>
);

const formatShortDate = (value: string) => {
  try {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
};

const PublicStatsPanel: React.FC<{ stats?: PublicStatsScope; weeklyStats?: PublicStatsScope }> = ({ stats, weeklyStats }) => {
  const source = stats ?? {
    scope: 'overall', score: 0, games_played: 0, wins: 0, losses: 0, win_rate: 0,
    current_streak: 0, max_streak: 0, total_guesses: 0, avg_guesses: null,
    hint_games: 0, hint_wins: 0, guess_distribution: [0, 0, 0, 0, 0, 0],
  };
  const distribution = source.guess_distribution ?? [0, 0, 0, 0, 0, 0];
  const max = Math.max(...distribution, 1);
  return (
    <View style={styles.publicStatsBox}>
      <View style={styles.statsRow}>
        <View style={styles.statBox}><Text style={styles.statValue}>{source.games_played}</Text><Text style={styles.statLabel}>Played</Text></View>
        <View style={styles.statBox}><Text style={styles.statValue}>{source.win_rate}%</Text><Text style={styles.statLabel}>Win Rate</Text></View>
        <View style={styles.statBox}><Text style={styles.statValue}>{source.current_streak}</Text><Text style={styles.statLabel}>Streak</Text></View>
        <View style={styles.statBox}><Text style={styles.statValue}>{source.max_streak}</Text><Text style={styles.statLabel}>Best</Text></View>
      </View>
      <Text style={styles.avgLine}>Score {source.score} · This week {weeklyStats?.score ?? 0} · Avg guesses per win: {source.avg_guesses ?? '-'}</Text>
      {distribution.map((count, index) => (
        <View key={index} style={styles.distRow}>
          <Text style={styles.distNum}>{index + 1}</Text>
          <View style={[styles.distBar, { flex: count ? count / max : 0.08 }]}><Text style={styles.distCount}>{count}</Text></View>
        </View>
      ))}
    </View>
  );
};

const AchievementCard: React.FC<{ item: AchievementProgress }> = ({ item }) => {
  const pct = Math.min(100, Math.round((item.current / Math.max(item.target, 1)) * 100));
  return (
    <View style={[styles.achievementCard, item.unlocked && styles.achievementUnlocked]}>
      <Text style={styles.achievementIcon}>{item.icon}</Text>
      <View style={styles.achievementCopy}>
        <View style={styles.achievementTitleRow}>
          <Text style={styles.achievementTitle}>{item.title}</Text>
          <Text style={[styles.achievementStatus, item.unlocked && styles.achievementStatusUnlocked]}>{item.unlocked ? 'Unlocked' : `${item.current}/${item.target}`}</Text>
        </View>
        <Text style={styles.achievementDesc}>{item.description}</Text>
        <View style={styles.achievementTrack}><View style={[styles.achievementFill, { width: `${pct}%` }]} /></View>
      </View>
    </View>
  );
};

const LeaderboardRow: React.FC<{ entry: LeaderboardEntry; current?: boolean; onPress?: (entry: LeaderboardEntry) => void }> = ({ entry, current, onPress }) => (
  <TouchableOpacity style={[styles.leaderboardRow, current && styles.leaderboardRowCurrent]} onPress={() => onPress?.(entry)} activeOpacity={0.82}>
    <Text style={styles.leaderRank}>#{entry.rank}</Text>
    <Text style={styles.leaderEmoji}>{entry.emoji || '🙂'}</Text>
    <View style={styles.leaderNameWrap}>
      <Text style={styles.leaderName} numberOfLines={1}>{entry.username}{current ? ' (You)' : ''}</Text>
      <Text style={styles.leaderMeta}>{entry.wins} wins · {entry.win_rate}% · streak {entry.current_streak}/{entry.max_streak}</Text>
    </View>
    <View style={styles.leaderScoreWrap}>
      <Text style={styles.leaderScore}>{entry.score}</Text>
      <Text style={styles.leaderAvg}>{entry.avg_guesses ? `${entry.avg_guesses} avg` : 'no avg'}</Text>
    </View>
  </TouchableOpacity>
);

const IconMark: React.FC<{ name: 'dots' | 'info' | 'x' | 'chat' | 'share' | 'send'; color: string }> = ({ name, color }) => {
  if (name === 'dots') {
    return <View style={styles.verticalDots}>{[0, 1, 2].map(dot => <View key={dot} style={[styles.dotIcon, { backgroundColor: color }]} />)}</View>;
  }
  if (name === 'x') {
    return <Text style={[styles.inlineIconText, { color }]}>×</Text>;
  }
  if (name === 'info') {
    return <Text style={[styles.inlineIconText, { color }]}>i</Text>;
  }
  if (name === 'chat') {
    return (
      <View style={[styles.chatIconBox, { borderColor: color }]}>
        <View style={[styles.chatIconTail, { borderTopColor: color }]} />
      </View>
    );
  }
  if (name === 'share') {
    return <Text style={[styles.inlineIconText, { color }]}>↗</Text>;
  }
  return <Text style={[styles.inlineIconText, { color }]}>›</Text>;
};

const SettingToggle: React.FC<{ label: string; value: boolean; onPress: () => void; disabled?: boolean; note?: string }> = ({ label, value, onPress, disabled = false, note }) => (
  <TouchableOpacity style={[styles.settingRow, disabled && styles.settingDisabled]} onPress={onPress} activeOpacity={disabled ? 1 : 0.78} disabled={disabled}>
    <View style={styles.settingCopy}>
      <Text style={styles.menuText}>{label}</Text>
      {!!note && <Text style={styles.settingNote}>{note}</Text>}
    </View>
    <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </View>
  </TouchableOpacity>
);

const StatsSummary: React.FC<{
  stats: any;
  activeTab: StatsTab;
  onTabChange?: (tab: StatsTab) => void;
  gameStatus: 'playing' | 'won' | 'lost';
  guesses: string[];
  compact?: boolean;
}> = ({ stats, activeTab, onTabChange, gameStatus, guesses, compact = false }) => {
  const source = activeTab === 'overall'
    ? stats
    : { gamesPlayed: 0, wins: 0, losses: 0, currentStreak: 0, maxStreak: 0, guessDistribution: [0, 0, 0, 0, 0, 0], ...(stats.byDifficulty?.[activeTab] ?? {}) };
  const winPct = source.gamesPlayed > 0 ? Math.round((source.wins / source.gamesPlayed) * 100) : 0;
  const avgGuesses = source.wins > 0
    ? (source.guessDistribution.reduce((sum: number, count: number, index: number) => sum + count * (index + 1), 0) / source.wins).toFixed(1)
    : '-';
  const maxDist = Math.max(...source.guessDistribution, 1);
  const tabs: StatsTab[] = ['overall', 'easy', 'moderate', 'difficult', 'prodigy'];

  return (
    <>
      {!compact && (
        <View style={styles.statsTabs}>
          {tabs.map(tab => (
            <TouchableOpacity key={tab} style={[styles.statsTab, activeTab === tab && styles.statsTabActive]} onPress={() => onTabChange?.(tab)}>
              <Text style={[styles.statsTabText, activeTab === tab && styles.statsTabTextActive]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.statsRow}>
        {[{ v: source.gamesPlayed, l: 'Played' }, { v: `${winPct}%`, l: 'Win Rate' }, { v: source.currentStreak, l: 'Streak' }, { v: source.maxStreak, l: 'Best' }].map(({ v, l }) => (
          <View key={l} style={styles.statBox}><Text style={styles.statValue}>{v}</Text><Text style={styles.statLabel}>{l}</Text></View>
        ))}
      </View>
      {!compact && <Text style={styles.avgLine}>Avg guesses per win: <Text style={{ fontWeight: '800' }}>{avgGuesses}</Text></Text>}
      {!compact && source.guessDistribution.map((count: number, idx: number) => {
      const pct = Math.max((count / maxDist) * 100, 5);
      return (
        <View key={idx} style={styles.distRow}>
          <Text style={styles.distNum}>{idx + 1}</Text>
          <View style={[styles.distBar, { width: `${pct}%` }]}><Text style={styles.distCount}>{count}</Text></View>
        </View>
      );
      })}
    </>
  );
};

const createThemeStyles = (palette: Palette) => StyleSheet.create({
  root: { backgroundColor: palette.bg },
  panel: { backgroundColor: palette.surface, borderColor: palette.border },
  card: { backgroundColor: palette.panel, borderColor: palette.border },
  iconBtn: { backgroundColor: palette.surface, borderColor: palette.border },
  input: { backgroundColor: palette.input, borderColor: palette.border, color: palette.text },
  titleText: { color: palette.text },
  bodyText: { color: palette.text },
  mutedText: { color: palette.muted },
  subtleText: { color: palette.subtle },
  blueAction: { backgroundColor: palette.blue, borderColor: palette.blue },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F16', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0F16' },
  mutedText: { color: '#9CA3AF', fontSize: 14, marginTop: 10 },
  appFrame: { flex: 1, width: '100%', maxWidth: 440, backgroundColor: '#0B0F16' },
  appFrameWide: { maxWidth: 980, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#1F2937' },
  appFrameHomeWide: { maxWidth: 1240, borderLeftWidth: 0, borderRightWidth: 0 },
  screen: { flex: 1, paddingHorizontal: 20, paddingBottom: 18 },
  scrollScreen: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22 },
  centeredScreen: { justifyContent: 'center' },
  floatingBack: { position: 'absolute', left: 20, top: 12, width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  splashBody: { flex: 1, justifyContent: 'center', gap: 34 },
  brandBlock: { alignItems: 'center' },
  logoMark: { width: 76, height: 76, borderRadius: 20, backgroundColor: '#16C75A', alignItems: 'center', justifyContent: 'center', shadowColor: '#16C75A', shadowOpacity: 0.55, shadowRadius: 24, elevation: 12 },
  logoMarkSmall: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#16C75A', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 6 },
  logoMarkText: { color: '#fff', fontSize: 34, fontWeight: '900' },
  brand: { color: '#F8FAFC', fontSize: 34, fontWeight: '900', letterSpacing: 0, textAlign: 'center', marginTop: 24 },
  brandAccent: { color: '#16C75A' },
  homeSubtitle: { color: '#F8FAFC', opacity: 0.86, fontSize: 15, marginTop: 8, textAlign: 'center', fontWeight: '700' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18 },
  featurePill: { color: '#D1D5DB', fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  splashActions: { gap: 12 },
  pageTitle: { color: '#F8FAFC', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 18 },
  pageSub: { color: '#9CA3AF', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 6, marginBottom: 24 },
  topBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12 },
  smallIconBtn: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  smallIconText: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  topTitleWrap: { flex: 1, minWidth: 0 },
  topTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  topSubtitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '800', marginTop: 2 },
  topActions: { flexDirection: 'row', gap: 8 },
  modeCard: { minHeight: 108, borderRadius: 18, borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 12 },
  soloCard: { borderColor: '#16C75A', backgroundColor: '#10251A' },
  partyCard: { borderColor: '#8B5CF6', backgroundColor: '#201538' },
  modeIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#16C75A', alignItems: 'center', justifyContent: 'center' },
  partyIcon: { backgroundColor: '#8B5CF6' },
  modeIconText: { color: '#fff', fontSize: 24, fontWeight: '900' },
  modeCopy: { flex: 1 },
  modeTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '900', textTransform: 'uppercase' },
  modeDesc: { color: '#D1D5DB', fontSize: 13, lineHeight: 18, marginTop: 6, fontWeight: '700' },
  seoPanel: { marginTop: 18, borderTopWidth: 1, borderTopColor: '#1F2937', paddingTop: 18, gap: 8 },
  seoTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  seoSubtitle: { color: '#16C75A', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', marginTop: 8 },
  seoText: { color: '#CBD5E1', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  seoLinkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  seoLink: { color: '#60A5FA', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  homeScroll: { flexGrow: 1, paddingHorizontal: 18, paddingVertical: 18 },
  homeScrollMobile: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 18 },
  homeShell: { width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 14 },
  homeTopBar: { minHeight: 70, borderRadius: 22, borderWidth: 1, borderColor: '#2A1B55', backgroundColor: 'rgba(8,12,26,0.92)', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  homeTopBarMobile: { alignItems: 'flex-start', flexWrap: 'wrap' },
  homeBackBtn: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  homeBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 210 },
  homeLogoTiles: { width: 42, height: 42, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  homeLogoTile: { width: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  homeLogoGreen: { backgroundColor: '#22C55E' },
  homeLogoYellow: { backgroundColor: '#FBBF24' },
  homeLogoPurple: { backgroundColor: '#8B5CF6' },
  homeLogoTileText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  homeLogoName: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', letterSpacing: 1 },
  homeLogoSub: { color: '#AEB8CF', fontSize: 11, fontWeight: '800' },
  homeNav: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  homeNavLink: { color: '#B8C2D8', fontSize: 12, fontWeight: '900', textDecorationLine: 'none', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: '#10182A' },
  homeNavButton: { borderRadius: 12, backgroundColor: '#2A2108', borderWidth: 1, borderColor: '#FACC15', paddingHorizontal: 10, paddingVertical: 8 },
  homeNavButtonText: { color: '#FDE68A', fontSize: 12, fontWeight: '900' },
  homePanel: { borderRadius: 28, borderWidth: 1, borderColor: '#6D28D9', backgroundColor: '#07101F', padding: 20, flexDirection: 'row', gap: 20, overflow: 'hidden' },
  homePanelMobile: { padding: 14, borderRadius: 22, flexDirection: 'column' },
  homeHeroCopy: { flex: 1.05, justifyContent: 'center', gap: 10, minWidth: 0 },
  homeEyebrow: { color: '#A78BFA', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  homeTitle: { color: '#FFFFFF', fontSize: 42, lineHeight: 47, fontWeight: '900' },
  homeTitleMobile: { fontSize: 30, lineHeight: 35 },
  homeDesc: { color: '#D4DCEC', fontSize: 15, lineHeight: 23, fontWeight: '700', maxWidth: 620 },
  homeDescMobile: { fontSize: 14, lineHeight: 21 },
  homeActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  homeActionGridMobile: { flexDirection: 'column' },
  homeModeCard: { flexGrow: 1, flexBasis: 230, minHeight: 198, borderRadius: 20, borderWidth: 1, padding: 18, gap: 10, justifyContent: 'space-between' },
  homeSoloCard: { borderColor: '#16C75A', backgroundColor: '#082B1A' },
  homeDailyCard: { borderColor: '#FACC15', backgroundColor: '#2A2108' },
  homePartyCard: { borderColor: '#8B5CF6', backgroundColor: '#1D123A' },
  homeChallengeCard: { borderColor: '#38BDF8', backgroundColor: '#08283A' },
  homeModeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  homeModeIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: '#16C75A', alignItems: 'center', justifyContent: 'center' },
  homeDailyIcon: { backgroundColor: '#FACC15' },
  homePartyIcon: { backgroundColor: '#7C3AED' },
  homeChallengeIcon: { backgroundColor: '#0284C7' },
  homeModeIconText: { color: '#FFFFFF', fontSize: 23, fontWeight: '900' },
  homeModeArrow: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  homeModeTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  homeModeDesc: { color: '#D8E1F1', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  homeModeCta: { alignSelf: 'flex-start', marginTop: 4, color: '#FFFFFF', backgroundColor: '#16A34A', borderRadius: 13, overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, fontWeight: '900' },
  homeDailyCta: { backgroundColor: '#FACC15', color: '#111827' },
  homePartyCta: { backgroundColor: '#7C3AED' },
  homeChallengeCta: { backgroundColor: '#0284C7' },
  homeArtCard: { flex: 0.8, minHeight: 360, borderRadius: 24, borderWidth: 1, borderColor: '#2B2254', backgroundColor: '#0A1020', overflow: 'hidden', justifyContent: 'flex-end' },
  homeArtImage: { position: 'absolute', width: '120%', height: '120%', opacity: 0.86 },
  homeArtBadge: { alignSelf: 'flex-start', margin: 16, borderRadius: 999, backgroundColor: 'rgba(5,7,17,0.72)', paddingHorizontal: 14, paddingVertical: 9 },
  homeArtBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  homeFeatureStrip: { display: 'none' },
  homeFeature: { flexGrow: 1, flexBasis: 160, minHeight: 72, borderRadius: 16, backgroundColor: '#111B2D', paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  homeFeatureIcon: { fontSize: 22, marginBottom: 4 },
  homeFeatureTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  homeFeatureText: { color: '#AEB8CF', fontSize: 11, fontWeight: '800', marginTop: 2 },
  homeSeoGrid: { display: 'none' },
  homeSeoPanel: { flexGrow: 1, flexBasis: 280, borderRadius: 18, borderWidth: 1, borderColor: '#202B46', backgroundColor: '#0D1728', padding: 16, gap: 8 },
  homeReadMore: { color: '#60A5FA', fontSize: 13, fontWeight: '900', textDecorationLine: 'none', marginTop: 4 },
  homeFooterLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, paddingVertical: 4 },
  difficultyList: { gap: 10, marginTop: 12 },
  diffCard: { minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: '#283447', backgroundColor: '#151C27', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  diffBadge: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  diffBadgeText: { color: '#fff', fontWeight: '900' },
  diffTextWrap: { flex: 1 },
  diffTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '900', textTransform: 'uppercase' },
  diffDesc: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', marginTop: 3 },
  diffGuesses: { color: '#D1D5DB', fontSize: 11, fontWeight: '900' },
  primaryBtn: { minHeight: 52, borderRadius: 14, backgroundColor: '#16C75A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, shadowColor: '#16C75A', shadowOpacity: 0.25, shadowRadius: 12, elevation: 4 },
  outlineBtn: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  outlineText: { color: '#F8FAFC', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  inputLabel: { color: '#D1D5DB', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginTop: 14, marginBottom: 6 },
  input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: '#283447', backgroundColor: '#151C27', color: '#F8FAFC', paddingHorizontal: 14, fontSize: 15, fontWeight: '800' },
  challengeInput: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: '#31557E', backgroundColor: '#10243A', color: '#F8FAFC', paddingHorizontal: 16, fontSize: 24, fontWeight: '900', letterSpacing: 7, textAlign: 'center', marginTop: 8 },
  challengeHint: { color: '#9CA3AF', fontSize: 12, lineHeight: 18, fontWeight: '800', marginVertical: 10 },
  inputError: { borderColor: '#EF4444' },
  profileDisplay: { minHeight: 58, borderRadius: 15, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileDisplayEmoji: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1F2937', textAlign: 'center', textAlignVertical: 'center', fontSize: 20, overflow: 'hidden' },
  fieldError: { color: '#EF4444', fontSize: 12, fontWeight: '800', marginTop: 6 },
  emojiPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiOption: { width: 38, height: 38, borderRadius: 13, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  emojiOptionActive: { borderColor: '#16C75A', backgroundColor: '#10251A' },
  emojiOptionText: { fontSize: 18 },
  emojiPickerButton: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  emojiPickerButtonText: { fontSize: 24 },
  emojiPickerLabel: { color: '#D1D5DB', fontSize: 13, fontWeight: '800' },
  emojiGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 6 },
  emojiOptionLarge: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  emojiOptionLargeText: { fontSize: 22 },
  createPartyBtn: { marginTop: 14 },
  joinRow: { flexDirection: 'row', gap: 10 },
  joinInput: { flex: 1, letterSpacing: 3, textTransform: 'uppercase' },
  joinBtn: { minHeight: 52, borderRadius: 12, backgroundColor: '#8B5CF6', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  line: { flex: 1, height: 1, backgroundColor: '#283447' },
  dividerText: { color: '#64748B', fontWeight: '900', textTransform: 'uppercase', fontSize: 10 },
  recentBox: { borderRadius: 16, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', padding: 14, marginTop: 16 },
  recentTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  recentEmpty: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', marginTop: 6 },
  recentRow: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#283447', backgroundColor: '#151C27', paddingHorizontal: 12, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  recentCode: { color: '#F8FAFC', fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  recentMeta: { color: '#9CA3AF', fontSize: 12, fontWeight: '800' },
  createdBody: { flex: 1, justifyContent: 'center', gap: 14 },
  createdCodeBox: { minHeight: 78, borderRadius: 16, backgroundColor: '#151C27', borderWidth: 1, borderColor: '#283447', alignItems: 'center', justifyContent: 'center' },
  createdCode: { color: '#F8FAFC', fontSize: 30, fontWeight: '900', letterSpacing: 9 },
  waitingText: { color: '#D1D5DB', fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  gameScreen: { flex: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  partyActionArea: { width: '100%', maxWidth: 520, alignSelf: 'center', position: 'relative', marginBottom: 8 },
  partyActionStrip: { width: '100%', minHeight: 58, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', borderRadius: 16, padding: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 5, overflow: 'hidden' },
  partyVoiceWrap: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  actionIconBtn: { width: 38, height: 38, borderRadius: 13, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  challengeAction: { minHeight: 38, borderRadius: 13, borderWidth: 1, borderColor: '#31557E', backgroundColor: '#10243A', paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  challengeActionText: { color: '#BFDBFE', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  chatPreviewPopup: { position: 'absolute', left: 8, right: 8, top: 62, minHeight: 38, borderRadius: 13, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', justifyContent: 'center', paddingHorizontal: 10, zIndex: 8 },
  chatPreviewText: { color: '#F8FAFC', fontSize: 11, fontWeight: '800' },
  shareBoardAction: { minHeight: 38, maxWidth: 78, borderRadius: 13, borderWidth: 1, borderColor: '#31557E', backgroundColor: '#2563EB', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0 },
  shareBoardText: { color: '#fff', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  chatBadge: { position: 'absolute', right: -3, top: -4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  chatBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  voicePanel: { width: '100%', maxWidth: 520, alignSelf: 'center', borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', borderRadius: 16, padding: 9, marginBottom: 8, gap: 6 },
  voicePanelCompact: { paddingVertical: 7, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  voiceLabel: { color: '#9CA3AF', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  playerStrip: { width: '100%', maxWidth: 520, alignSelf: 'center', flexDirection: 'row', gap: 6, marginBottom: 8 },
  playerStripCompact: { marginBottom: 4, justifyContent: 'center' },
  playerChip: { flex: 1, minHeight: 34, borderRadius: 12, backgroundColor: '#111827', borderWidth: 1, borderColor: '#283447', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6 },
  playerChipCompact: { flex: 0, width: 45, minHeight: 32, justifyContent: 'center', paddingHorizontal: 5 },
  playerChipText: { flex: 1, color: '#F8FAFC', fontSize: 11, fontWeight: '800' },
  boardShell: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', alignItems: 'center', justifyContent: 'flex-start', minHeight: 0 },
  boardLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  boardLoadingText: { color: '#9CA3AF', fontSize: 12, fontWeight: '800' },
  toastSlot: { height: 24, justifyContent: 'center' },
  toast: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  toastText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  warningToastText: { color: '#111827' },
  hintBar: { width: '100%', maxWidth: 420, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  hintButton: { minHeight: 34, borderRadius: 12, backgroundColor: '#2A2108', borderWidth: 1, borderColor: '#FACC15', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  hintButtonDisabled: { opacity: 0.5 },
  hintButtonText: { color: '#FDE68A', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  hintTrayButton: { flex: 1, minWidth: 0, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintPreviewChip: { flex: 1, minWidth: 0 },
  hintTextChip: { minHeight: 34, borderRadius: 12, backgroundColor: '#2A2108', borderWidth: 1, borderColor: '#B45309', paddingHorizontal: 10, justifyContent: 'center' },
  hintChipKicker: { color: '#FACC15', fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  hintInlineText: { color: '#FDE68A', fontSize: 10, fontWeight: '800' },
  hintLetterPill: { minHeight: 34, borderRadius: 12, backgroundColor: '#14331F', borderWidth: 1, borderColor: '#16C75A', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hintLetterLabel: { color: '#BBF7D0', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  hintLetterValue: { minWidth: 28, textAlign: 'center', color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  hintFullCard: { borderRadius: 16, borderWidth: 1, borderColor: '#B45309', backgroundColor: '#2A2108', padding: 14, gap: 8 },
  hintFullHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  hintFullKicker: { color: '#FACC15', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  hintFullText: { color: '#FDE68A', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  hintFullLetterBadge: { borderRadius: 999, backgroundColor: '#14331F', borderWidth: 1, borderColor: '#16C75A', paddingHorizontal: 10, paddingVertical: 4 },
  hintFullLetterBadgeText: { color: '#BBF7D0', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  hintEmptyText: { color: '#9CA3AF', fontSize: 13, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  segment: { width: '100%', maxWidth: 420, flexDirection: 'row', borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', borderRadius: 14, padding: 3, marginBottom: 8, zIndex: 4 },
  segmentBtn: { flex: 1, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: '#16C75A' },
  segmentText: { color: '#9CA3AF', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  segmentTextActive: { color: '#fff' },
  challengeProgressPanel: { width: '100%', maxWidth: 520, borderRadius: 15, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', padding: 8, marginBottom: 6, gap: 6 },
  challengeProgressHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  challengeTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  challengeMeta: { color: '#9CA3AF', fontSize: 10, fontWeight: '800' },
  challengeProgressList: { gap: 8, paddingRight: 2 },
  challengeChip: { minWidth: 138, maxWidth: 156, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#283447', backgroundColor: '#0B1220', paddingHorizontal: 8, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 7 },
  challengeChipMine: { borderColor: '#16C75A', backgroundColor: '#08251A' },
  challengeChipEmoji: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#1F2937', textAlign: 'center', textAlignVertical: 'center', fontSize: 16, overflow: 'hidden' },
  challengeChipBody: { flex: 1, minWidth: 0 },
  challengeChipName: { color: '#F8FAFC', fontSize: 11, fontWeight: '900' },
  challengeChipMeta: { color: '#93C5FD', fontSize: 10, fontWeight: '900', marginTop: 2 },
  challengeMiniGrid: { width: 18, gap: 2 },
  challengeMiniRow: { height: 3, borderRadius: 99, backgroundColor: '#243244' },
  challengeMiniRowFilled: { backgroundColor: '#64748B' },
  challengeMiniRowWon: { backgroundColor: '#16C75A' },
  gridWrap: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', minHeight: 150, position: 'relative' },
  liveCursor: { position: 'absolute', right: 8, top: 8, zIndex: 3, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: '#10243A', borderWidth: 1, borderColor: '#31557E', paddingHorizontal: 10, paddingVertical: 6 },
  liveCursorEmoji: { fontSize: 15 },
  liveCursorText: { color: '#BFDBFE', fontSize: 11, fontWeight: '900' },
  prompt: { width: '100%', borderRadius: 14, borderWidth: 1, borderColor: '#FACC15', backgroundColor: '#2A2108', padding: 10, marginBottom: 6 },
  promptText: { color: '#FDE68A', fontWeight: '800', fontSize: 13 },
  promptRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  acceptBtn: { backgroundColor: '#16C75A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  acceptText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  declineBtn: { borderRadius: 12, borderWidth: 1, borderColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 8 },
  declineText: { color: '#FCA5A5', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  disabledBtn: { opacity: 0.45 },
  socialSection: { gap: 8, marginTop: 4 },
  friendsScroll: { maxHeight: 520 },
  socialSectionTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  socialRow: { minHeight: 54, borderRadius: 15, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9 },
  socialAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1F2937', textAlign: 'center', textAlignVertical: 'center', fontSize: 18, overflow: 'hidden' },
  socialInfo: { flex: 1, minWidth: 0 },
  socialName: { color: '#F8FAFC', fontSize: 13, fontWeight: '900' },
  socialMeta: { color: '#9CA3AF', fontSize: 11, fontWeight: '800', marginTop: 2, textTransform: 'capitalize' },
  profileActions: { gap: 8, marginBottom: 10 },
  friendRowWrap: { position: 'relative', zIndex: 1 },
  friendRowWrapOpen: { zIndex: 30 },
  friendDotsBtn: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, borderColor: '#283447', backgroundColor: '#151C27', alignItems: 'center', justifyContent: 'center' },
  friendMenu: { position: 'absolute', right: 0, top: 42, width: 164, borderRadius: 14, borderWidth: 1, borderColor: '#31557E', backgroundColor: '#0F172A', padding: 6, gap: 6, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  friendMenuBtn: { minHeight: 34, borderRadius: 10, backgroundColor: '#10243A', borderWidth: 1, borderColor: '#31557E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  friendMenuText: { color: '#93C5FD', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  friendRemoveBtn: { backgroundColor: '#2A1115', borderColor: '#7F1D1D' },
  friendRemoveText: { color: '#FCA5A5', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  onlineDotActive: { backgroundColor: '#16C75A' },
  onlineDotMuted: { backgroundColor: '#64748B' },
  inviteText: { color: '#FDE68A', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  emptySocialText: { color: '#9CA3AF', fontSize: 12, fontWeight: '800', textAlign: 'center', paddingVertical: 8 },
  invitePopup: { position: 'absolute', left: 22, right: 22, top: '34%', borderRadius: 22, borderWidth: 1, borderColor: '#283447', backgroundColor: '#151C27', padding: 20, gap: 10, alignItems: 'center' },
  ghostBtn: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: '#283447', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  ghostText: { color: '#F8FAFC', fontWeight: '900', fontSize: 12, textTransform: 'uppercase' },
  inlineAction: { marginTop: 8, minHeight: 40, borderRadius: 13, backgroundColor: '#10243A', borderWidth: 1, borderColor: '#31557E', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  inlineActionText: { color: '#60A5FA', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  typingLine: { color: '#9CA3AF', fontSize: 11, fontWeight: '800', minHeight: 16, marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: { backgroundColor: '#151C27', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 1, borderColor: '#283447', gap: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  closeIconBtn: { width: 38, height: 38, borderRadius: 13, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { color: '#F8FAFC', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  sheetRow: { borderWidth: 1, borderColor: '#283447', borderRadius: 16, padding: 14, backgroundColor: '#111827' },
  sheetRowTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '900' },
  sheetRowMeta: { color: '#9CA3AF', fontSize: 13, marginTop: 4 },
  inviteCard: { borderRadius: 16, backgroundColor: '#111827', borderWidth: 1, borderColor: '#283447', padding: 14, gap: 12 },
  inviteActions: { flexDirection: 'row', gap: 10 },
  inviteBtn: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#175E35', backgroundColor: '#10251A', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  shareBtn: { borderColor: '#31557E', backgroundColor: '#10243A' },
  copyCode: { color: '#F8FAFC', fontSize: 24, fontWeight: '900', letterSpacing: 4 },
  copyLabel: { color: '#16C75A', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  shareLabel: { color: '#60A5FA', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  playerList: { gap: 8 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 38 },
  avatarDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center' },
  ownerDot: { backgroundColor: '#16C75A' },
  avatarEmoji: { fontSize: 13 },
  playerName: { flex: 1, color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16C75A' },
  dangerBtn: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#EF4444', fontWeight: '900', textTransform: 'uppercase' },
  infoGrid: { borderRadius: 16, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', padding: 12, gap: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  infoLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '800' },
  infoValue: { color: '#F8FAFC', fontSize: 12, fontWeight: '900' },
  centerModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.68)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  helpCard: { width: '100%', maxWidth: 390, borderRadius: 24, backgroundColor: '#151C27', borderWidth: 1, borderColor: '#283447', padding: 20, gap: 14 },
  helpText: { color: '#D1D5DB', fontSize: 14, lineHeight: 21, fontWeight: '700' },
  exampleWord: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  exampleTile: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155' },
  exampleGreen: { backgroundColor: '#16C75A' },
  exampleYellow: { backgroundColor: '#FACC15' },
  exampleGray: { backgroundColor: '#64748B' },
  exampleLetter: { color: '#fff', fontWeight: '900', fontSize: 18 },
  menuCard: { width: '100%', maxWidth: 390, borderRadius: 24, backgroundColor: '#151C27', borderWidth: 1, borderColor: '#283447', padding: 14, gap: 8 },
  leaderboardCard: { width: '100%', maxWidth: 720, maxHeight: '88%', borderRadius: 24, backgroundColor: '#151C27', borderWidth: 1, borderColor: '#283447', padding: 14, gap: 10 },
  publicProfileCard: { width: '100%', maxWidth: 620, maxHeight: '88%', borderRadius: 24, backgroundColor: '#151C27', borderWidth: 1, borderColor: '#283447', padding: 14, gap: 10 },
  publicProfileHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  publicProfileEmoji: { fontSize: 34, width: 42, textAlign: 'center' },
  publicProfileScroll: { maxHeight: 560 },
  publicProfileContent: { gap: 12, paddingBottom: 6 },
  publicStatsBox: { borderRadius: 18, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', padding: 14 },
  periodToggle: { flexDirection: 'row', borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', borderRadius: 14, padding: 4, gap: 4 },
  periodPill: { flex: 1, minHeight: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  periodPillActive: { backgroundColor: '#16C75A' },
  periodPillText: { color: '#9CA3AF', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  periodPillTextActive: { color: '#FFFFFF' },
  leaderboardTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  leaderboardTab: { minHeight: 32, borderRadius: 10, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  leaderboardTabActive: { borderColor: '#FACC15', backgroundColor: '#2A2108' },
  leaderboardTabText: { color: '#9CA3AF', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  leaderboardTabTextActive: { color: '#FDE68A' },
  leaderboardList: { maxHeight: 440 },
  leaderboardListContent: { gap: 8, paddingVertical: 4 },
  leaderboardRow: { minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  leaderboardRowCurrent: { borderColor: '#16C75A', backgroundColor: '#10251A' },
  leaderRank: { width: 42, color: '#FDE68A', fontSize: 13, fontWeight: '900' },
  leaderEmoji: { fontSize: 24, width: 30, textAlign: 'center' },
  leaderNameWrap: { flex: 1, minWidth: 0 },
  leaderName: { color: '#F8FAFC', fontSize: 14, fontWeight: '900' },
  leaderMeta: { color: '#9CA3AF', fontSize: 11, fontWeight: '800', marginTop: 3 },
  leaderScoreWrap: { alignItems: 'flex-end', minWidth: 58 },
  leaderScore: { color: '#16C75A', fontSize: 18, fontWeight: '900' },
  leaderAvg: { color: '#9CA3AF', fontSize: 10, fontWeight: '800' },
  leaderBadges: { color: '#FDE68A', fontSize: 10, fontWeight: '800', marginTop: 2 },
  achievementSectionTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '900', marginTop: 4 },
  achievementList: { gap: 8 },
  achievementCard: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  achievementUnlocked: { borderColor: '#16C75A', backgroundColor: '#10251A' },
  achievementIcon: { width: 34, fontSize: 24, textAlign: 'center' },
  achievementCopy: { flex: 1, minWidth: 0, gap: 5 },
  achievementTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  achievementTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '900', flex: 1 },
  achievementStatus: { color: '#9CA3AF', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  achievementStatusUnlocked: { color: '#16C75A' },
  achievementDesc: { color: '#9CA3AF', fontSize: 11, fontWeight: '700', lineHeight: 15 },
  achievementTrack: { height: 6, borderRadius: 999, backgroundColor: '#283447', overflow: 'hidden' },
  achievementFill: { height: '100%', borderRadius: 999, backgroundColor: '#16C75A' },
  rulesBox: { borderRadius: 18, borderWidth: 1, borderColor: '#FACC15', backgroundColor: '#2A2108', padding: 14, gap: 8 },
  ruleTitle: { color: '#FDE68A', fontSize: 18, fontWeight: '900' },
  ruleText: { color: '#FFF7C2', fontSize: 13, fontWeight: '800', lineHeight: 19 },
  ruleExample: { color: '#F8FAFC', fontSize: 13, fontWeight: '900', lineHeight: 19, marginTop: 5 },
  menuRow: { minHeight: 52, borderRadius: 14, backgroundColor: '#111827', borderWidth: 1, borderColor: '#283447', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuText: { color: '#F8FAFC', fontSize: 14, fontWeight: '900' },
  menuMuted: { color: '#9CA3AF', fontSize: 12, fontWeight: '900' },
  chevron: { color: '#9CA3AF', fontSize: 16, fontWeight: '900' },
  settingRow: { minHeight: 52, borderRadius: 14, backgroundColor: '#111827', borderWidth: 1, borderColor: '#283447', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settingDisabled: { opacity: 0.58 },
  settingCopy: { flex: 1, gap: 3 },
  settingNote: { color: '#9CA3AF', fontSize: 11, fontWeight: '700' },
  toggleTrack: { width: 46, height: 26, borderRadius: 999, backgroundColor: '#334155', padding: 3, justifyContent: 'center' },
  toggleTrackOn: { backgroundColor: '#16C75A' },
  toggleThumb: { width: 20, height: 20, borderRadius: 999, backgroundColor: '#F8FAFC' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  settingOptions: { flexDirection: 'row', gap: 6 },
  settingPill: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: '#283447', alignItems: 'center', justifyContent: 'center', backgroundColor: '#151C27' },
  settingPillText: { color: '#9CA3AF', fontSize: 12, fontWeight: '900' },
  themeToggle: { flexDirection: 'row', gap: 6 },
  themePill: { minWidth: 58, height: 32, borderRadius: 10, borderWidth: 1, borderColor: '#283447', alignItems: 'center', justifyContent: 'center', backgroundColor: '#151C27', paddingHorizontal: 10 },
  themePillActive: { borderColor: '#16C75A', backgroundColor: '#10251A' },
  themePillText: { color: '#9CA3AF', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  themePillTextActive: { color: '#16C75A' },
  verticalDots: { gap: 3, alignItems: 'center', justifyContent: 'center' },
  dotIcon: { width: 4, height: 4, borderRadius: 2 },
  inlineIconText: { fontSize: 20, fontWeight: '900', lineHeight: 22 },
  chatIconBox: { width: 18, height: 14, borderRadius: 5, borderWidth: 2 },
  chatIconTail: { position: 'absolute', left: 3, bottom: -6, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 0, borderTopWidth: 6, borderLeftColor: 'transparent' },
  chatList: { maxHeight: 230 },
  chatListContent: { gap: 8, paddingVertical: 4 },
  chatBubble: { alignSelf: 'flex-start', maxWidth: '86%', borderRadius: 14, backgroundColor: '#111827', borderWidth: 1, borderColor: '#283447', paddingHorizontal: 12, paddingVertical: 9 },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#10251A', borderColor: '#16C75A' },
  chatAuthor: { color: '#9CA3AF', fontSize: 10, fontWeight: '900', marginBottom: 3 },
  chatText: { color: '#F8FAFC', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  quickChatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickChatPill: { minHeight: 34, borderRadius: 999, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  quickChatText: { color: '#F8FAFC', fontSize: 11, fontWeight: '800' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatInput: { flex: 1, minHeight: 44 },
  chatSendBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#16C75A', alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,15,22,0.94)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  resultCard: { width: '100%', maxWidth: 360, borderRadius: 24, backgroundColor: '#151C27', borderWidth: 1, borderColor: '#283447', padding: 20, gap: 12, alignItems: 'stretch' },
  resultTitle: { fontSize: 28, fontWeight: '900', textAlign: 'center' },
  win: { color: '#FACC15' },
  loss: { color: '#EF4444' },
  answerText: { color: '#F8FAFC', textAlign: 'center', fontSize: 16, fontWeight: '800' },
  hintAssistedText: { color: '#FDE68A', textAlign: 'center', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  meaningCard: { borderRadius: 16, borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', padding: 14, gap: 5 },
  meaningWord: { color: '#F8FAFC', fontSize: 18, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' },
  meaningPos: { color: '#16C75A', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center' },
  meaningDefinition: { color: '#D1D5DB', fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  meaningExample: { color: '#9CA3AF', fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'center', fontStyle: 'italic' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  statsTabs: { flexDirection: 'row', gap: 4, marginBottom: 14 },
  statsTab: { flex: 1, minHeight: 30, borderRadius: 10, borderWidth: 1, borderColor: '#283447', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  statsTabActive: { borderColor: '#16C75A', backgroundColor: '#10251A' },
  statsTabText: { color: '#9CA3AF', fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  statsTabTextActive: { color: '#16C75A' },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { color: '#F8FAFC', fontSize: 24, fontWeight: '900' },
  statLabel: { color: '#9CA3AF', fontSize: 10, textTransform: 'uppercase', fontWeight: '800' },
  avgLine: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginBottom: 10 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  distNum: { width: 18, color: '#F8FAFC', fontWeight: '900', textAlign: 'right' },
  distBar: { height: 22, minWidth: 24, borderRadius: 5, backgroundColor: '#16C75A', alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 7 },
  distCount: { color: '#fff', fontWeight: '900', fontSize: 12 },
});
