import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api/client";
import { colors, radius, spacing, type } from "../theme";

/**
 * Stored selfies are served by an authenticated endpoint, so the Bearer token
 * has to ride along on the image request itself — a bare <Image uri> gets a 401.
 */
function sourceFor(photoKey: string) {
  return { uri: api.photoUrl(photoKey), headers: api.photoHeaders() };
}

export function PunchThumb({
  photoKey,
  label,
  onPress,
}: {
  photoKey: string;
  label: "IN" | "OUT";
  onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const tone = label === "IN" ? colors.ok : colors.warn;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={`View punch ${label.toLowerCase()} selfie`}
      style={({ pressed }) => [styles.thumbWrap, { opacity: pressed ? 0.7 : 1 }]}
    >
      {failed ? (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Ionicons name="image-outline" size={16} color={colors.muted} />
        </View>
      ) : (
        <Image
          source={sourceFor(photoKey)}
          style={styles.thumb}
          onError={() => setFailed(true)}
          resizeMode="cover"
        />
      )}
      <View style={[styles.thumbTag, { backgroundColor: tone }]}>
        <Text style={styles.thumbTagText}>{label}</Text>
      </View>
    </Pressable>
  );
}

export function PhotoViewer({
  photoKey,
  caption,
  onClose,
}: {
  photoKey: string | null;
  caption?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);

  return (
    <Modal
      visible={!!photoKey}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          onPress={onClose}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={styles.close}
        >
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>

        {photoKey ? (
          <View style={styles.full}>
            {loading ? (
              <ActivityIndicator color={colors.white} style={StyleSheet.absoluteFill} />
            ) : null}
            <Image
              source={sourceFor(photoKey)}
              style={styles.fullImage}
              resizeMode="contain"
              onLoadEnd={() => setLoading(false)}
            />
          </View>
        ) : null}

        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  thumbWrap: { width: 44, height: 56 },
  thumb: {
    width: 44,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  thumbTag: {
    position: "absolute",
    bottom: -4,
    alignSelf: "center",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  thumbTagText: { fontSize: 9, fontWeight: "700", color: colors.white, letterSpacing: 0.3 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  close: { position: "absolute", top: 48, right: spacing.xl, zIndex: 2 },
  full: { width: "100%", height: "78%" },
  fullImage: { width: "100%", height: "100%" },
  caption: { ...type.small, color: colors.white, marginTop: spacing.lg, textAlign: "center" },
});
