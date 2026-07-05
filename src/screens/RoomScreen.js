import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from "react-native";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { connect, getSocket, disconnect } from "../services/socket";

function fmt(t) {
  if (t == null || isNaN(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function srtToVtt(srt) {
  return "WEBVTT\n\n" + srt.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export default function RoomScreen({ route, navigation }) {
  const { roomCode, videoUrl, isOwner } = route.params;
  const videoViewRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
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

  useEventListener(player, "timeUpdate", (e) => {
    setCurrentTime(e.currentTime);
    if (e.currentTime > 0) setDuration(player.duration || 0);
  });

  const API = "http://109.122.250.39:3001";

  const applyTextTrack = useCallback((text, label) => {
    console.log("applyTextTrack called, text length:", text.length, "label:", label);
    let vtt = text.startsWith("WEBVTT") ? text : srtToVtt(text);
    const blob = new Blob([vtt], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    const video = videoContainerRef.current?.querySelector("video");
    if (!video) return false;
    const existing = video.querySelector("track");
    if (existing) existing.remove();
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.src = url;
    track.srclang = "en";
    track.label = label || "Subtitle";
    video.appendChild(track);
    const tt = track.track;
    if (tt) tt.mode = "showing";
    setSubtitleOn(true);
    return true;
  }, []);

  const pickSubtitleFile = useCallback(() => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".vtt,.srt,.ass,.ssa";
    input.onchange = async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const text = await file.text();
      applyTextTrack(text, file.name);
      try {
        const r = await fetch(API + "/upload-subtitle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomCode, fileName: file.name, content: toBase64(text) }),
        });
        console.log("Upload response:", r.status);
      } catch (e) { console.log("Upload failed:", e); }
    };
    input.click();
  }, [roomCode, applyTextTrack]);

  useEffect(() => { setSubtitleOn(false); }, [status]);

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
      player.play(); setIsPlaying(true);
    });

    socket.on("pause", (position) => {
      if (position > 0) player.currentTime = position;
      player.pause(); setIsPlaying(false);
    });

    socket.on("subtitle-loaded", (data) => {
      console.log("subtitle-loaded received, fileName:", data.fileName, "content length:", data.content?.length);
      if (Platform.OS !== "web") return;
      const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      console.log("Decoded text length:", text.length);
      applyTextTrack(text, data.fileName || "Subtitle");
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
      player.pause(); setIsPlaying(false);
      if (socket) socket.emit("pause", { roomCode, position: pos });
    } else {
      player.play(); setIsPlaying(true);
      if (socket) socket.emit("play", { roomCode, position: pos });
    }
  }, [isPlaying, player, roomCode]);

  const handleSeek = useCallback((e) => {
    if (!duration) return;
    const bar = seekBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const clientX = e?.nativeEvent?.touches?.[0]?.clientX ?? e?.nativeEvent?.clientX ?? e?.clientX;
    if (clientX == null) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const pos = ratio * duration;
    player.currentTime = pos;
    setCurrentTime(pos);
    const socket = getSocket();
    if (socket) socket.emit("seek", { roomCode, position: pos });
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
          onClick={handleSeek}
          onMouseDown={handleSeek}
          onTouchStart={handleSeek}
          onTouchMove={handleSeek}
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
              const v = videoContainerRef.current?.querySelector("video");
              const t = v?.querySelector("track");
              if (t && t.track) {
                t.track.mode = subtitleOn ? "hidden" : "showing";
                setSubtitleOn(!subtitleOn);
              }
            }}
          >
            <Text style={styles.ccText}>CC</Text>
          </TouchableOpacity>
        </View>

        {isOwner && (
          <TouchableOpacity style={styles.uploadBtn} onPress={pickSubtitleFile}>
            <Text style={styles.uploadBtnText}>Upload Subtitle File (.vtt / .srt)</Text>
          </TouchableOpacity>
        )}
      </View>
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
  seekFill: { height: 4, backgroundColor: "#6C5CE7", borderRadius: 2, position: "absolute", left: 0, top: 8 },
  seekThumb: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: "#6C5CE7",
    position: "absolute", top: 3, marginLeft: -7,
  },
  controls: { paddingHorizontal: 20, paddingVertical: 10, alignItems: "center" },
  controlsRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  controlButton: { borderRadius: 30, paddingVertical: 12, paddingHorizontal: 40, alignItems: "center" },
  playButton: { backgroundColor: "#6C5CE7" },
  pauseButton: { backgroundColor: "#E17055" },
  controlText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  ccButton: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: "#333", alignItems: "center" },
  ccActive: { backgroundColor: "#6C5CE7" },
  ccText: { color: "#fff", fontSize: 14, fontWeight: "bold", letterSpacing: 1 },
  uploadBtn: {
    width: "100%", borderRadius: 8, paddingVertical: 12,
    backgroundColor: "#2d2d2d", borderWidth: 1, borderColor: "#555",
    borderStyle: "dashed", alignItems: "center",
  },
  uploadBtnText: { color: "#aaa", fontSize: 13 },
});
