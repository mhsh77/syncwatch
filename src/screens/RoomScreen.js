import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { connect, getSocket, disconnect } from "../services/socket";

export default function RoomScreen({ route, navigation }) {
  const { roomCode, videoUrl, isOwner } = route.params;
  const videoViewRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleOn, setSubtitleOn] = useState(false);
  const videoContainerRef = useRef(null);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });

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

  const autoDetectSubtitle = useCallback(async () => {
    const base = videoUrl.replace(/\.[^.]+$/, "");
    const candidates = [
      base + ".vtt",
      base + ".srt",
      base + ".persian.srt",
      base + ".fa.srt",
      base + "_fa.srt",
      base + ".en.srt",
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) {
          applyTrack(url);
          return;
        }
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
      if (state.position > 0) {
        player.currentTime = state.position;
      }
      if (state.isPlaying) {
        player.play();
        setIsPlaying(true);
      } else {
        player.pause();
        setIsPlaying(false);
      }
      setIsSyncing(false);
    });

    socket.on("play", (position) => {
      if (position > 0) {
        player.currentTime = position;
      }
      player.play();
      setIsPlaying(true);
    });

    socket.on("pause", (position) => {
      if (position > 0) {
        player.currentTime = position;
      }
      player.pause();
      setIsPlaying(false);
    });

    socket.on("user-joined", () => {
      Alert.alert("Partner joined", "Your watch partner has connected!");
    });

    return () => {
      socket.off("sync-state");
      socket.off("play");
      socket.off("pause");
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

      <View style={styles.controls}>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[
              styles.controlButton,
              isPlaying ? styles.pauseButton : styles.playButton,
            ]}
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
      </View>

      <Text style={styles.hint}>
        Controls are synced pause/play affects both viewers
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f0f",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  roomLabel: {
    color: "#6C5CE7",
    fontSize: 18,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  roleLabel: {
    color: "#888",
    fontSize: 14,
  },
  videoContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  controls: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: "center",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  controlButton: {
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 48,
    alignItems: "center",
  },
  playButton: {
    backgroundColor: "#6C5CE7",
  },
  pauseButton: {
    backgroundColor: "#E17055",
  },
  controlText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  ccButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#333",
    alignItems: "center",
  },
  ccActive: {
    backgroundColor: "#6C5CE7",
  },
  ccText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  subtitleInput: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    color: "#ccc",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#333",
  },
  loadBtn: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: "#6C5CE7",
    alignItems: "center",
  },
  loadBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
  },
  hint: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    paddingBottom: 40,
  },
});
