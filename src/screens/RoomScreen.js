import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform } from "react-native";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { connect, getSocket, disconnect } from "../services/socket";

function fmt(t) {
  if (t == null || isNaN(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

export default function RoomScreen({ route, navigation }) {
  const { roomCode, videoUrl, isOwner } = route.params;
  const videoViewRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleOn, setSubtitleOn] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoContainerRef = useRef(null);
  const seekBarRef = useRef(null);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.5;
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEvent(player, "timeUpdate", (e) => {
    setCurrentTime(e.currentTime);
    if (e.currentTime > 0) setDuration(player.duration || 0);
  });

  const applyTrack = useCallback((url) => {
    if (!videoContainerRef.current) return false;
    const video = videoContainerRef.current.querySelector("video");
    if (!video) return false;
    const existing = video.querySelector("track");
    if (existing) existing.remove();
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.src = url;
    track.srclang = "en";
    track.label = "Subtitle";
    track.default = true;
    video.appendChild(track);
    video.textTracks[0].mode = "showing";
    setSubtitleUrl(url);
    setSubtitleOn(true);
    return true;
  }, []);

  const loadExternalSubtitle = useCallback(() => {
    if (!subtitleUrl.trim()) return;
    applyTrack(subtitleUrl.trim());
  }, [subtitleUrl, applyTrack]);

  const pickSubtitleFile = useCallback(async () => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".vtt,.srt,.ass,.ssa";
    input.onchange = async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(",")[1];
        try {
          const res = await fetch("/upload-subtitle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomCode, fileName: file.name, content: base64 }),
          });
          const data = await res.json();
          applyTrack(data.url);
          setSubtitleUrl(file.name);
        } catch (_) {
          Alert.alert("Error", "Failed to upload subtitle");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [roomCode, applyTrack]);

  const autoDetectSubtitle = useCallback(async () => {
    const base = videoUrl.replace(/\.[^.]+$/, "");
    const candidates = [
      base + ".vtt", base + ".srt",
      base + ".persian.srt", base + ".fa.srt",
      base + "_fa.srt", base + ".en.srt",
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) { applyTrack(url); return; }
      } catch (_) {}
    }
  }, [videoUrl, applyTrack]);

  useEffect(() => {
    if (status !== "readyToPlay") return;
    setSubtitleOn(false);
    const timer = setInterval(() => {
      if (videoContainerRef.current?.querySelector("video")) {
        clearInterval(timer);
        autoDetectSubtitle();
      }
    }, 200);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const socket = connect();
    if (!socket) return;

    socket.emit("join-room", { roomCode });

    socket.on("sync-state", (state) => {
      if (state.position > 0) player.currentTime = state.position;
      if (state.isPlaying) { player.play(); setIsPlaying(true); }
      else { player.pause(); setIsPlaying(false); }
      setIsSyncing(false);
    });

    socket.on("play", (position) => {
      if (position > 0) player.currentTime = position;
      player.play();
      setIsPlaying(true);
    });

    socket.on("pause", (position) => {
      if (position > 0) player.currentTime = position;
      player.pause();
      setIsPlaying(false);
    });

    socket.on("subtitle-loaded", (url) => {
      if (Platform.OS === "web") applyTrack(url);
    });

    socket.on("user-joined", () => {
      Alert.alert("Partner joined", "Your watch partner has connected!");
    });

    return () => {
      socket.off("sync-state");
      socket.off("play");
      socket.off("pause");
      socket.off("subtitle-loaded");
      socket.off("user-joined");
      disconnect();
    };
  }, []);

  const hasAutoPlayed = useRef(false);
  useEffect(() => {
    if (isOwner && !isSyncing && status === "readyToPlay" && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      player.play();
      setIsPlaying(true);
      const socket = getSocket();
      if (socket) socket.emit("play", { roomCode, position: player.currentTime });
    }
  }, [isSyncing, status]);

  const togglePlayback = useCallback(() => {
    const socket = getSocket();
    const pos = player.currentTime;
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      if (socket) socket.emit("pause", { roomCode, position: pos });
    } else {
      player.play();
      setIsPlaying(true);
      if (socket) socket.emit("play", { roomCode, position: pos });
    }
  }, [isPlaying, player, roomCode]);

  const handleSeek = useCallback((e) => {
    if (!seekBarRef.current || !duration) return;
    seekBarRef.current.measure((x, y, w, h, pageX, pageY) => {
      const clientX = "touches" in e.nativeEvent ? e.nativeEvent.touches[0].clientX : e.nativeEvent.clientX || pageX;
      const rect = seekBarRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const pos = ratio * duration;
      player.currentTime = pos;
      setCurrentTime(pos);
      const socket = getSocket();
      if (socket) socket.emit("seek", { roomCode, position: pos });
    });
  }, [duration, player, roomCode]);

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.roomLabel}>Room: {roomCode}</Text>
        <Text style={styles.roleLabel}>{isOwner ? "Owner" : "Joined"}</Text>
      </View>

      <View style={styles.videoContainer} ref={videoContainerRef}>
        <VideoView
          ref={videoViewRef}
          player={player}
          style={styles.video}
          nativeControls={false}
          contentFit="contain"
        />
      </View>

      <View style={styles.seekContainer}>
        <Text style={styles.timeText}>{fmt(currentTime)}</Text>
        <View
          ref={seekBarRef}
          style={styles.seekTrack}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleSeek}
          onResponderMove={handleSeek}
        >
          <View style={[styles.seekFill, { width: (progress * 100) + "%" }]} />
          <View style={[styles.seekThumb, { left: (progress * 100) + "%" }]} />
        </View>
        <Text style={styles.timeText}>{fmt(duration)}</Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.controlButton, isPlaying ? styles.pauseButton : styles.playButton]}
            onPress={togglePlayback}
          >
            <Text style={styles.controlText}>{isPlaying ? "Pause" : "Play"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ccButton, subtitleOn && styles.ccActive]}
            onPress={() => {
              if (subtitleOn) {
                const v = videoContainerRef.current?.querySelector("video");
                if (v && v.textTracks[0]) v.textTracks[0].mode = "hidden";
                setSubtitleOn(false);
              } else {
                const v = videoContainerRef.current?.querySelector("video");
                if (v && v.textTracks[0]) v.textTracks[0].mode = "showing";
                else loadExternalSubtitle();
                setSubtitleOn(true);
              }
            }}
          >
            <Text style={styles.ccText}>CC</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.subtitleRow}>
          <TextInput
            style={styles.subtitleInput}
            placeholder="Subtitle .vtt URL (optional)"
            placeholderTextColor="#555"
            value={subtitleUrl}
            onChangeText={setSubtitleUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.loadBtn} onPress={loadExternalSubtitle}>
            <Text style={styles.loadBtnText}>Load</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.uploadBtn} onPress={pickSubtitleFile}>
          <Text style={styles.uploadBtnText}>Upload Subtitle File</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>Controls are synced — affects both viewers</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f0f" },
  header: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 20, paddingTop: 60, paddingBottom: 10,
  },
  roomLabel: { color: "#6C5CE7", fontSize: 18, fontWeight: "bold", letterSpacing: 2 },
  roleLabel: { color: "#888", fontSize: 14 },
  videoContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000" },
  video: { width: "100%", height: "100%" },
  seekContainer: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 8, gap: 8,
  },
  timeText: { color: "#aaa", fontSize: 12, fontVariant: ["tabular-nums"], minWidth: 35, textAlign: "center" },
  seekTrack: {
    flex: 1, height: 20, justifyContent: "center",
    backgroundColor: "transparent", position: "relative",
  },
  seekFill: {
    height: 4, backgroundColor: "#6C5CE7", borderRadius: 2,
    position: "absolute", left: 0, top: 8,
  },
  seekThumb: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: "#6C5CE7",
    position: "absolute", top: 3, marginLeft: -7,
  },
  controls: { paddingHorizontal: 20, paddingVertical: 10, alignItems: "center" },
  controlsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  controlButton: { borderRadius: 30, paddingVertical: 12, paddingHorizontal: 40, alignItems: "center" },
  playButton: { backgroundColor: "#6C5CE7" },
  pauseButton: { backgroundColor: "#E17055" },
  controlText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  ccButton: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: "#333", alignItems: "center" },
  ccActive: { backgroundColor: "#6C5CE7" },
  ccText: { color: "#fff", fontSize: 14, fontWeight: "bold", letterSpacing: 1 },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: 8, width: "100%" },
  subtitleInput: {
    flex: 1, backgroundColor: "#1a1a1a", color: "#ccc",
    borderRadius: 8, padding: 10, fontSize: 13,
    borderWidth: 1, borderColor: "#333",
  },
  loadBtn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#6C5CE7", alignItems: "center" },
  loadBtnText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  uploadBtn: {
    width: "100%", borderRadius: 8, paddingVertical: 10, marginTop: 8,
    backgroundColor: "#2d2d2d", borderWidth: 1, borderColor: "#555",
    borderStyle: "dashed", alignItems: "center",
  },
  uploadBtnText: { color: "#aaa", fontSize: 13 },
  hint: { color: "#555", fontSize: 12, textAlign: "center", paddingBottom: 30 },
});
