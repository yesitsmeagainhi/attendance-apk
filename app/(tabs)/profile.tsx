import { ComponentProps, useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { api, ApiError, Profile } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button, Card, Label, Muted, Notice } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";
import { s } from "../../src/lib/responsive";
import { API_BASE_URL, IS_PRODUCTION_TARGET } from "../../src/config";
import { formatShiftTime } from "../../src/lib/punch";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // Load saved avatar from device storage on mount
  useEffect(() => {
    const f = new File(Paths.document, "profile_avatar.jpg");
    if (f.exists) setAvatarUri(f.uri + "?t=" + Date.now());
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.profile();
      setProfile(res.profile);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow access to your photos in Settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await saveAvatar(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow camera access in Settings.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await saveAvatar(result.assets[0].uri);
    }
  }

  async function saveAvatar(uri: string) {
    const dest = new File(Paths.document, "profile_avatar.jpg");
    await new File(uri).copy(dest, { overwrite: true });
    // Bust the Image cache with a timestamp query
    setAvatarUri(dest.uri + "?t=" + Date.now());
  }

  function removeAvatar() {
    const f = new File(Paths.document, "profile_avatar.jpg");
    if (f.exists) f.delete();
    setAvatarUri(null);
  }

  function onAvatarPress() {
    const options: { text: string; onPress?: () => void; style?: "cancel" | "destructive" }[] = [
      { text: "Take a photo", onPress: takePhoto },
      { text: "Choose from gallery", onPress: pickFromGallery },
    ];
    if (avatarUri) {
      options.push({ text: "Remove photo", onPress: removeAvatar, style: "destructive" });
    }
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Profile photo", "Update your profile picture", options);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.white} />
        }
      >
        {/* ── Header ── */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Profile</Text>
        </View>

        {error ? <Notice>{error}</Notice> : null}

        {profile ? (
          <>
            {/* ── Hero card ── */}
            <View style={styles.hero}>
              {/* Tappable avatar */}
              <Pressable
                onPress={onAvatarPress}
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
                style={({ pressed }) => [styles.avatarRing, { opacity: pressed ? 0.8 : 1 }]}
              >
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(profile.name)}</Text>
                  </View>
                )}
                {/* Camera badge */}
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={s(12)} color={colors.white} />
                </View>
              </Pressable>

              <Text style={styles.heroName}>{profile.name}</Text>
              {profile.jobRole ? (
                <Text style={styles.heroRole}>{profile.jobRole}</Text>
              ) : null}
              <View style={styles.heroBadge}>
                <Ionicons name="business-outline" size={s(12)} color={colors.accent} />
                <Text style={styles.heroBadgeText}>{profile.office}</Text>
              </View>
            </View>

            {/* ── Work details ── */}
            <Card>
              <Label>Work details</Label>
              <InfoRow
                icon="briefcase-outline"
                label="Role"
                value={profile.jobRole || "—"}
              />
              <InfoRow
                icon="time-outline"
                label="Shift"
                value={`${formatShiftTime(profile.workStartTime)} – ${formatShiftTime(profile.workEndTime)}`}
              />
            </Card>

            {/* ── Account details ── */}
            <Card>
              <Label>Account</Label>
              <InfoRow
                icon="card-outline"
                label="Employee ID"
                value={profile.id}
              />
              <InfoRow
                icon="call-outline"
                label="Mobile"
                value={profile.mobileNumber || "—"}
              />
              {profile.createdAt ? (
                <InfoRow
                  icon="calendar-outline"
                  label="Member since"
                  value={formatMemberSince(profile.createdAt)}
                />
              ) : null}
            </Card>
          </>
        ) : null}

        {/* ── Session ── */}
        <Card>
          <Label>Session</Label>
          <View style={styles.sessionNotice}>
            <Ionicons name="shield-checkmark-outline" size={s(18)} color={colors.inkSoft} />
            <Muted>
              You are signed in on this device only. Signing in elsewhere will end this session.
            </Muted>
          </View>
          <Button
            label="Sign out"
            variant="danger"
            busy={signingOut}
            onPress={async () => {
              setSigningOut(true);
              await signOut();
            }}
          />
        </Card>

        <Text style={styles.server}>
          {IS_PRODUCTION_TARGET ? "Production" : "Dev server"} · {API_BASE_URL}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={s(16)} color={colors.brand} />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },

  pageHeader: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  pageTitle: { ...type.display, color: colors.ink },

  /* Hero */
  hero: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  avatarRing: {
    width: s(84),
    height: s(84),
    borderRadius: s(42),
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  avatar: {
    width: s(78),
    height: s(78),
    borderRadius: s(39),
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: s(78),
    height: s(78),
    borderRadius: s(39),
  },
  avatarText: {
    fontSize: s(28),
    fontWeight: "700",
    color: colors.white,
    letterSpacing: 1,
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.brand,
  },
  heroName: {
    ...type.title,
    color: colors.white,
    fontSize: s(22),
    textAlign: "center",
  },
  heroRole: {
    ...type.small,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(5),
    backgroundColor: colors.accentTint,
    paddingHorizontal: spacing.md,
    paddingVertical: s(5),
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  heroBadgeText: {
    ...type.small,
    color: colors.accent,
    fontWeight: "600",
  },

  /* Info rows */
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: s(6),
  },
  infoIconWrap: {
    width: s(34),
    height: s(34),
    borderRadius: radius.sm,
    backgroundColor: colors.brandTint,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: { flex: 1 },
  infoLabel: { ...type.small, color: colors.muted, marginBottom: s(2) },
  infoValue: { ...type.body, color: colors.ink, fontWeight: "600" },

  /* Session */
  sessionNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },

  server: { ...type.small, color: colors.muted, fontSize: s(11), textAlign: "center" },
});
