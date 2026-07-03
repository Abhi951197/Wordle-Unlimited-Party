import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import { ActiveBoard, AnswerInfo, ChatMessage, HintState, useGameState } from '@/store/GameState';
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
    startGame, createRoom, joinRoom, leaveRoom, createSharedGame, createIndividualGame, changeRoomDifficulty,
    setActiveBoard, requestShareBoard, respondToShareRequest, gameStatus, currentGuess,
    addLetter, removeLetter, submitGuess, guesses, results, wordLength, letterStates,
    sessionId, difficulty, roomId, playerId, playerEmoji, roomPlayers, maxRoomPlayers, typingPlayerName, typingPlayerEmoji, livekit, activeBoard,
    shareRequest, chatMessages, sendChatMessage, stats, invalidShake, lastSubmittedRow, answer, answerInfo, maxGuesses, toast,
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
  const [seenChatId, setSeenChatId] = useState<string | null>(null);
  const [chatPopupVisible, setChatPopupVisible] = useState(false);
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

  const startSelectedDifficulty = async (nextDifficulty = difficulty) => {
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
    if (!roomName.trim()) {
      setNameError('Enter your name to continue');
      return;
    }
    setNameError('');
    const created = await createRoom(difficulty, roomName, selectedEmoji);
    if (created) setView('roomCreated');
  };

  const joinParty = async () => {
    if (!roomName.trim()) {
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
    const joined = await joinRoom(joinCode, roomName, selectedEmoji);
    if (joined) {
      if (joinCode.trim()) void saveRecentRoom(joinCode.trim().toUpperCase(), roomName);
      setView('party');
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

  const goBack = () => {
    if (view === 'splash') return;
    if (view === 'mode') return;
    else if (view === 'difficulty') setView('mode');
    else if (view === 'roomCreated') setView('party');
    else if (view === 'solo') setView('difficulty');
    else if (view === 'party' && !roomId) setView('mode');
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
      {roomId && <Text style={styles.typingLine}>{typingPlayerName ? `${typingPlayerName} is typing...` : activeBoard === 'shared' ? 'Shared board ready' : 'Your private board'}</Text>}
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, themed.root]}>
      <View style={[styles.appFrame, themed.root, isWide && styles.appFrameWide]}>
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
          <ScrollView contentContainerStyle={[styles.scrollScreen, styles.centeredScreen]} showsVerticalScrollIndicator={false}>
            <TouchableOpacity style={styles.floatingBack} onPress={goBack}><Text style={styles.smallIconText}>{'<'}</Text></TouchableOpacity>
            <Text style={[styles.pageTitle, themed.titleText]}>Choose Game Mode</Text>
            <Text style={[styles.pageSub, themed.mutedText]}>Play your way</Text>
            <TouchableOpacity style={[styles.modeCard, styles.soloCard]} onPress={() => chooseMode('solo')} activeOpacity={0.82}>
              <View style={styles.modeIcon}><Text style={styles.modeIconText}>S</Text></View>
              <View style={styles.modeCopy}>
                <Text style={styles.modeTitle}>Solo Mode</Text>
                <Text style={styles.modeDesc}>Play alone and challenge yourself.</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeCard, styles.partyCard]} onPress={() => chooseMode('party')} activeOpacity={0.82}>
              <View style={[styles.modeIcon, styles.partyIcon]}><Text style={styles.modeIconText}>P</Text></View>
              <View style={styles.modeCopy}>
                <Text style={styles.modeTitle}>Party Mode</Text>
                <Text style={styles.modeDesc}>Play with friends in real time with optional voice.</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.seoPanel}>
              <Text accessibilityRole="header" style={styles.seoTitle}>Wordle Unlimited Party</Text>
              <Text style={styles.seoText}>
                Play unlimited Wordle online in solo mode or create a multiplayer party room with friends. Rooms support shared boards, private boards, real-time typing, hints, answer meanings, and optional voice chat.
              </Text>
              <Text style={styles.seoSubtitle}>How to play</Text>
              <Text style={styles.seoText}>
                Guess the hidden five-letter word. Green letters are correct, yellow letters are in the word but placed differently, and dark letters are not in the answer.
              </Text>
              <Text style={styles.seoSubtitle}>Features</Text>
              <Text style={styles.seoText}>
                Unlimited puzzles, multiplayer Wordle rooms, live voice chat, shareable invite links, multiple difficulty levels, useful hints, statistics, and mobile-friendly gameplay.
              </Text>
              <Text style={styles.seoSubtitle}>FAQ</Text>
              <Text style={styles.seoText}>
                Is it free? Yes. Do I need an account? No. Can I play with friends? Yes, create a party room and share the link or room code.
              </Text>
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
            <Text style={[styles.inputLabel, themed.subtleText]}>Your name</Text>
            <TextInput
              value={roomName}
              onChangeText={(value) => { setRoomName(value); if (nameError) setNameError(''); }}
              placeholder=""
              placeholderTextColor="#64748B"
              style={[styles.input, themed.input, nameError && styles.inputError]}
              autoCorrect={false}
            />
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
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStatsModal(false)}><Text style={styles.primaryText}>Close</Text></TouchableOpacity>
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
            {answer && <Text style={styles.answerText}>{gameStatus === 'won' ? `The word was ${answer}` : `The word was ${answer}`}</Text>}
            {hintsUsed > 0 && <Text style={styles.hintAssistedText}>Hint-assisted</Text>}
            {answerInfo && <AnswerMeaningCard info={answerInfo} />}
            <StatsSummary stats={stats} activeTab="overall" gameStatus={gameStatus} guesses={guesses} compact />
            {roomId ? (
              <>
                <TouchableOpacity style={styles.primaryBtn} onPress={createSharedGame}><Text style={styles.primaryText}>Continue Together</Text></TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={createIndividualGame}><Text style={styles.outlineText}>Play Individually</Text></TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => startGame(difficulty)}><Text style={styles.primaryText}>Play Again</Text></TouchableOpacity>
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
  inputError: { borderColor: '#EF4444' },
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
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: '#283447', backgroundColor: '#111827', borderRadius: 14, padding: 3, marginBottom: 8, zIndex: 4 },
  segmentBtn: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 11 },
  segmentActive: { backgroundColor: '#16C75A' },
  segmentText: { color: '#9CA3AF', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  segmentTextActive: { color: '#fff' },
  gridWrap: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', minHeight: 150, position: 'relative' },
  liveCursor: { position: 'absolute', right: 8, top: 8, zIndex: 3, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: '#10243A', borderWidth: 1, borderColor: '#31557E', paddingHorizontal: 10, paddingVertical: 6 },
  liveCursorEmoji: { fontSize: 15 },
  liveCursorText: { color: '#BFDBFE', fontSize: 11, fontWeight: '900' },
  prompt: { width: '100%', borderRadius: 14, borderWidth: 1, borderColor: '#FACC15', backgroundColor: '#2A2108', padding: 10, marginBottom: 6 },
  promptText: { color: '#FDE68A', fontWeight: '800', fontSize: 13 },
  promptRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  acceptBtn: { backgroundColor: '#16C75A', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
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
