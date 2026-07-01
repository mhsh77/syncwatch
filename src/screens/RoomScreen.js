import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { connect, getSocket, disconnect } from "../services/socket";

export default function RoomScreen({ route, navigation }) {
  const { roomCode, videoUrl, isOwner } = route.params;
  const videoViewRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
  });

  const { status } = useEvent(player, "statusChange", { status: player.status });

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

  useEffect(() => {
    if (isOwner && !isSyncing && status === "readyToPlay") {
      player.play();
      setIsPlaying(true);
      const socket = getSocket();
      if (socket) socket.emit("play", { roomCode, position: player.currentTime });
    }
  }, [isSyncing, status]);

  const togglePlayback = useCallback(() => {
    const socket = getSocket();
    const pos = player.currentTime;
    if (player.playing) {
      player.pause();
      setIsPlaying(false);
      if (socket) socket.emit("pause", { roomCode, position: pos });
    } else {
      player.play();
      setIsPlaying(true);
      if (socket) socket.emit("play", { roomCode, position: pos });
    }
  }, [player, roomCode]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.roomLabel}>Room: {roomCode}</Text>
        <Text style={styles.roleLabel}>{isOwner ? "Owner" : "Joined"}</Text>
      </View>

      <View style={styles.videoContainer}>
        <VideoView
          ref={videoViewRef}
          player={player}
          style={styles.video}
          nativeControls={false}
          contentFit="contain"
        />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[
            styles.controlButton,
            isPlaying ? styles.pauseButton : styles.playButton,
          ]}
          onPress={togglePlayback}
        >
          <Text style={styles.controlText}>{isPlaying ? "Pause" : "Play"}</Text>
        </TouchableOpacity>
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
    paddingVertical: 24,
    alignItems: "center",
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
  hint: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    paddingBottom: 40,
  },
});
