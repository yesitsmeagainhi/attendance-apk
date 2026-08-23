import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, ApiError } from "../src/api/client";
import { Notice } from "../src/components/ui";
import {
  Chip,
  EmptyState,
  FilterChips,
  Loading,
  Row,
  ScreenHeader,
} from "../src/components/adminui";
import { PhotoViewer } from "../src/components/PunchPhoto";
import {
  FeedItem,
  FeedKind,
  useNotifications,
} from "../src/notifications/NotificationCenter";
import { formatDate } from "../src/lib/punch";
import { colors, radius, spacing } from "../src/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** One tinted circle per kind, reusing the tile palette from the admin home. */
const LOOKS: Record<FeedKind, { icon: IconName; tone: string; bg: string }> = {
  punch: { icon: "finger-print", tone: colors.brand, bg: colors.brandTint },
  request: { icon: "mail-outline", tone: "#B0348C", bg: "#FBEBF6" },
  birthday: { icon: "gift", tone: colors.warn, bg: colors.warnTint },
  otp: { icon: "key", tone: colors.warn, bg: colors.warnTint },
};

/**
 * Feed timestamps are the server's SQLite CURRENT_TIMESTAMP — UTC written
 * without a zone. Parsing the clock digits as local would shift every row by
 * 5.5 hours, so the Z is appended the way punch.ts does, unless the string
 * already carries a zone of its own (the derived birthday entries do).
 */
function parseStamp(raw: string): Date | null {
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const d = new Date(zoned ? iso : `${iso}Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** Local YYYY-MM-DD, built from local parts so the day never slips a date. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function relative(raw: string, now: number): string {
  const d = parseStamp(raw);
  if (!d) return raw;
  const diff = now - d.getTime();
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(localDay(d));
}

/**
 * The row's left slot.
 *
 * A punch that carries a real selfie shows it; everything else gets its kind's
 * circle. PunchThumb is not reused here because its 44x56 portrait plate and
 * IN/OUT tag belong on the timesheet — in a mixed feed the thumbnails have to
 * line up with the icon circles beside them.
 *
 * Selfies come from an authenticated endpoint, so the Bearer token has to ride
 * along on the image request itself; a bare uri comes back 401 and renders as
 * an empty box, which is what the fallback covers.
 */
function FeedLeft({ item }: { item: FeedItem }) {
  const [failed, setFailed] = useState(false);
  const look = LOOKS[item.kind];
  const key = item.kind === "punch" ? item.photoKey : null;

  // Rebuilt only when the key changes. The provider re-renders the whole feed
  // on every 60s poll, and a fresh source object each time makes every visible
  // thumbnail re-diff and re-resolve its native image prop for nothing.
  const source = useMemo(
    () => (key ? { uri: api.photoUrl(key), headers: api.photoHeaders() } : null),
    [key],
  );

  if (source && !failed) {
    return (
      <Image
        source={source}
        style={styles.thumb}
        onError={() => setFailed(true)}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.tile, { backgroundColor: look.bg }]}>
      <Ionicons name={look.icon} size={18} color={look.tone} />
    </View>
  );
}

/**
 * The notification centre.
 *
 * Pushed from the bell in both roles' headers, so everything here reads off the
 * shared feed rather than calling the API — the provider already knows whether
 * it is watching a whole office or one person's own requests.
 *
 * Opening the screen clears the badge, but the rows that WERE unread keep their
 * dot for the length of the visit: letting markAllRead repaint the list under
 * the user's thumb would answer "what is new?" by erasing the answer. So the
 * ids are snapshotted before the watermark moves, and the dots are drawn from
 * that snapshot afterwards.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { items, loading, refresh, markAllRead } = useNotifications();

  const [filter, setFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [wasUnread, setWasUnread] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Declared BEFORE the markAllRead effect on purpose: effects run in
  // declaration order within a commit, so this captures the unread ids while
  // the watermark is still the old one. It keeps merging afterwards so an item
  // that lands mid-visit is still marked as new.
  useEffect(() => {
    const fresh = items.filter((i) => i.unread).map((i) => i.id);
    if (!fresh.length) return;
    setWasUnread((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      // Same size means nothing was actually added — returning prev stops this
      // effect re-triggering itself off a fresh Set identity.
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  // Once per mount. Guarded by a ref rather than a dependency list so a poll
  // landing mid-visit cannot re-fire it.
  //
  // Held back until the feed has actually been observed once. The provider sits
  // ABOVE this screen in the tree and effects run child-first, so on a cold
  // start or a push-banner tap that lands straight on this route, this used to
  // fire before the provider's very first refresh — moving the watermark past a
  // batch nothing had snapshotted yet, so the rows arrived already-read and the
  // "what is new?" dots never appeared at all. sawLoad keeps the empty feed
  // that follows a completed load from stranding the badge forever.
  const marked = useRef(false);
  const sawLoad = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    if (loading) {
      sawLoad.current = true; // a first load is in flight — wait it out
      return;
    }
    if (!items.length && !sawLoad.current) return; // nothing observed yet
    marked.current = true;
    void markAllRead();
  }, [loading, items, markAllRead]);

  // Its own flag: reusing `loading` would tie the pull spinner to the
  // provider's background poll, and it would never appear on a real pull.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't refresh notifications.");
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const counts = useMemo(() => {
    let punch = 0;
    let request = 0;
    let birthday = 0;
    let otp = 0;
    for (const i of items) {
      if (i.kind === "punch") punch += 1;
      else if (i.kind === "request") request += 1;
      else if (i.kind === "otp") otp += 1;
      else birthday += 1;
    }
    return { punch, request, birthday, otp };
  }, [items]);

  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  // Counted against the live feed rather than the raw snapshot: an item that
  // has since aged out of today's window should not keep padding the header.
  const newCount = useMemo(
    () => items.filter((i) => wasUnread.has(i.id)).length,
    [items, wasUnread],
  );

  const chips: Chip[] = [
    { key: "all", label: "All", count: items.length },
    { key: "otp", label: "Codes", count: counts.otp },
    { key: "punch", label: "Punches", count: counts.punch },
    { key: "request", label: "Requests", count: counts.request },
    { key: "birthday", label: "Birthdays", count: counts.birthday },
  ];

  const busy = loading && !items.length;
  const now = Date.now();

  const openPhoto = useCallback((item: FeedItem) => {
    if (!item.photoKey) return;
    setCaption(`${item.title} · ${item.body}`);
    setPhotoKey(item.photoKey);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScreenHeader
        title="Notifications"
        subtitle={busy ? "Loading…" : newCount ? `${newCount} new` : "Up to date"}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />

      <View style={styles.controls}>
        <FilterChips chips={chips} active={filter} onChange={setFilter} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {error ? <Notice>{error}</Notice> : null}

        {busy ? <Loading /> : null}

        {shown.map((item) => (
          <Row
            key={item.id}
            left={<FeedLeft item={item} />}
            title={item.title}
            titleLines={2}
            subtitle={item.body}
            meta={relative(item.at, now)}
            right={wasUnread.has(item.id) ? <View style={styles.unread} /> : undefined}
            onPress={item.kind === "punch" && item.photoKey ? () => openPhoto(item) : undefined}
          />
        ))}

        {!busy && !error && !shown.length ? (
          <EmptyState
            icon="notifications-off-outline"
            title={items.length ? "Nothing here" : "Nothing yet"}
            body={
              items.length
                ? "No notifications of this kind right now."
                : "Punches, requests and birthdays will show up here."
            }
          />
        ) : null}
      </ScrollView>

      <PhotoViewer
        photoKey={photoKey}
        caption={caption || undefined}
        onClose={() => setPhotoKey(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  scroll: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  tile: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  // A dot, not a repainted card: an unread row stays exactly as loud as the
  // read ones beside it.
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
});
