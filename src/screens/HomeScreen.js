import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";

export default function HomeScreen({ navigation }) {
  const [videoUrl, setVideoUrl] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);

  const createRoom = async () => {
    if (!videoUrl.trim()) {
      Alert.alert("Error", "Please enter a video URL");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("http://109.122.250.39:3001/create-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: videoUrl.trim() }),
      });
      const data = await res.json();
      setLoading(false);
      navigation.replace("Room", {
        roomCode: data.roomCode,
        videoUrl: data.videoUrl,
        isOwner: true,
      });
    } catch (e) {
      setLoading(false);
      Alert.alert("Error", "Could not connect to server");
    }
  };

  const joinRoom = async () => {
    if (!roomCode.trim()) {
      Alert.alert("Error", "Please enter a room code");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("http://109.122.250.39:3001/join-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: roomCode.trim().toUpperCase() }),
      });
      if (!res.ok) {
        setLoading(false);
        Alert.alert("Error", "Room not found");
        return;
      }
      const data = await res.json();
      setLoading(false);
      navigation.replace("Room", {
        roomCode: data.roomCode,
        videoUrl: data.videoUrl,
        isOwner: false,
      });
    } catch (e) {
      setLoading(false);
      Alert.alert("Error", "Could not connect to server");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SyncWatch</Text>
      <Text style={styles.subtitle}>Watch together, apart</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Video URL</Text>
        <TextInput
          style={styles.input}
          placeholder="https://example.com/video.mp4"
          placeholderTextColor="#666"
          value={videoUrl}
          onChangeText={setVideoUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.button, styles.createButton]}
          onPress={createRoom}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Room</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.orText}>OR</Text>
        <View style={styles.line} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Join Existing Room</Text>
        <TextInput
          style={[styles.input, styles.codeInput]}
          placeholder="Room Code"
          placeholderTextColor="#666"
          value={roomCode}
          onChangeText={setRoomCode}
          autoCapitalize="characters"
          maxLength={4}
        />
        <TouchableOpacity
          style={[styles.button, styles.joinButton]}
          onPress={joinRoom}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Join Room</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f0f",
    padding: 24,
    justifyContent: "center",
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    textAlign: "center",
    marginBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    color: "#ccc",
    fontSize: 14,
    marginBottom: 8,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#333",
    marginBottom: 12,
  },
  codeInput: {
    textAlign: "center",
    fontSize: 24,
    letterSpacing: 8,
    fontWeight: "bold",
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  createButton: {
    backgroundColor: "#6C5CE7",
  },
  joinButton: {
    backgroundColor: "#00B894",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 24,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#333",
  },
  orText: {
    color: "#666",
    marginHorizontal: 16,
    fontWeight: "600",
  },
});
