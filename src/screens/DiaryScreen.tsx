import React, { useState } from 'react';
import { ScrollView, View, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme-context';
import { useI18n } from '../i18n';
import { useData } from '../useData';
import { store, uid, todayStr } from '../store';
import {
  Surface,
  TopAppBar,
  FAB,
  Snackbar,
  Segmented,
  ListRow,
  Button,
  EmptyState,
  IconTile,
  M3Text,
  Chip,
  TextField,
} from '../components/ui';
import { Icon, ICONS } from '../icons';
import { useSubPageBottomInset } from '../components/layout';
import { radius, pageMargin, cardGap } from '../tokens';
import type { JournalEntry, InboxItem, MediaItem, MediaType, MediaStatus } from '../types';

type Seg = 'diary' | 'inbox' | 'media';
type UndoState = { msg: string; undo: () => Promise<void> } | null;

const MOODS = ['🙂', '😊', '🥰', '😌', '😢', '😡'];

export default function DiaryScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const d = useData();
  // §二 「记录/速记」不再是隐藏 tab，而是「今日」栈里的二级页：需要返回键，
  // 且底部不再有浮动胶囊底栏，所以留白用 sub-page 版本（额外给 FAB 让位）。
  const bottomInset = useSubPageBottomInset(72);
  const [seg, setSeg] = useState<Seg>('diary');
  const [adding, setAdding] = useState(false);
  const [snack, setSnack] = useState<UndoState>(null);

  const toggleInbox = async (it: InboxItem) => {
    const prev = { ...it };
    const list = await store.getInbox();
    await store.setInbox(list.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)));
    setSnack({
      msg: prev.done ? t('plan.toggleUndone') : t('record.markComplete'),
      undo: async () => {
        const l = await store.getInbox();
        await store.setInbox(l.map((x) => (x.id === it.id ? prev : x)));
      },
    });
    setTimeout(() => setSnack(null), 4000);
  };

  const fabLabel = seg === 'diary' ? t('record.fabDiary') : seg === 'inbox' ? t('record.fabInbox') : t('record.fabMedia');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopAppBar
        title={t('tabs.record')}
        subtitle={t('record.subtitle')}
        onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined}
      />
      <View style={{ paddingHorizontal: pageMargin, paddingTop: 12 }}>
        <Segmented
          segments={[
            { key: 'diary', label: t('record.segDiary') },
            { key: 'inbox', label: t('record.segInbox') },
            { key: 'media', label: t('record.segMedia') },
          ]}
          active={seg}
          onChange={setSeg}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: pageMargin, paddingBottom: bottomInset }}>
        {seg === 'diary' && <DiarySub entries={d.journal} adding={adding} setAdding={setAdding} theme={theme} />}
        {seg === 'inbox' && <InboxSub items={d.inbox} adding={adding} setAdding={setAdding} onToggle={toggleInbox} theme={theme} />}
        {seg === 'media' && <MediaSub items={d.media} adding={adding} setAdding={setAdding} theme={theme} />}
      </ScrollView>
      {!adding && <FAB icon={ICONS.add} label={fabLabel} onPress={() => setAdding(true)} />}
      {snack && (
        <Snackbar
          message={snack.msg}
          actionLabel={t('common.undo')}
          onAction={() => {
            snack.undo();
            setSnack(null);
          }}
          style={{ bottom: 88 }}
        />
      )}
    </View>
  );
}

function DiarySub({
  entries,
  adding,
  setAdding,
  theme,
}: {
  entries: JournalEntry[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  theme: any;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mood, setMood] = useState('🙂');
  const [date, setDate] = useState(todayStr());
  const submit = async () => {
    if (!body.trim() && !title.trim()) return;
    const list = await store.getJournal();
    await store.setJournal([
      { id: uid('j'), title: title.trim() || t('record.noTitle'), body: body.trim(), mood, date, createdAt: Date.now() },
      ...list,
    ]);
    setTitle('');
    setBody('');
    setMood('🙂');
    setDate(todayStr());
    setAdding(false);
  };
  return (
    <>
      {adding && (
        <Surface level={1} style={{ padding: 16, marginBottom: cardGap, borderRadius: radius.card }}>
          <M3Text role="titleMedium" style={{ marginBottom: 12 }}>
            {t('record.writeDiary')}
          </M3Text>
          <View style={{ marginBottom: 10 }}>
            <TextField label={t('record.dateLabel')} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ marginBottom: 10 }}>
            <TextField label={t('record.titleLabel')} value={title} onChangeText={setTitle} placeholder={t('record.titlePlaceholder')} />
          </View>
          <View style={{ marginBottom: 10 }}>
            <TextField label={t('record.bodyLabel')} value={body} onChangeText={setBody} placeholder={t('record.bodyPlaceholder')} multiline numberOfLines={4} />
          </View>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 6 }}>
            {t('record.mood')}
          </M3Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {MOODS.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => setMood(m)}
                style={{ padding: 6, borderRadius: radius.md, backgroundColor: mood === m ? theme.primaryContainer : theme.surfaceContainer }}
              >
                <M3Text style={{ fontSize: 18 }}>{m}</M3Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Button label={t('common.save')} variant="primary" onPress={submit} style={{ flex: 1 }} />
            <Button label={t('common.cancel')} variant="text" onPress={() => setAdding(false)} style={{ flex: 1 }} />
          </View>
        </Surface>
      )}
      {entries.length === 0 && !adding && <EmptyState icon={ICONS.journal} title={t('record.emptyDiary')} hint={t('record.emptyDiaryHint')} />}
      {entries.map((e) => (
        <Surface key={e.id} level={0} style={{ padding: 16, marginBottom: cardGap, borderRadius: radius.card }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <M3Text role="titleMedium">{e.title}</M3Text>
            <M3Text style={{ fontSize: 18 }}>{e.mood}</M3Text>
          </View>
          <M3Text role="labelMedium" color={theme.onSurfaceVariant} style={{ marginBottom: 4 }}>
            {e.date}
          </M3Text>
          <M3Text role="bodyMedium" color={theme.onSurfaceVariant}>
            {e.body}
          </M3Text>
        </Surface>
      ))}
    </>
  );
}

function InboxSub({
  items,
  adding,
  setAdding,
  onToggle,
  theme,
}: {
  items: InboxItem[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  onToggle: (it: InboxItem) => void;
  theme: any;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const submit = async () => {
    if (!text.trim()) return;
    const list = await store.getInbox();
    await store.setInbox([{ id: uid('i'), text: text.trim(), done: false, createdAt: Date.now() }, ...list]);
    setText('');
    setAdding(false);
  };
  return (
    <>
      {adding && (
        <Surface level={1} style={{ padding: 16, marginBottom: cardGap, borderRadius: radius.card }}>
          <M3Text role="titleMedium" style={{ marginBottom: 12 }}>
            {t('record.quickNote')}
          </M3Text>
          <View style={{ marginBottom: 14 }}>
            <TextField label={t('record.contentLabel')} value={text} onChangeText={setText} placeholder={t('record.contentPlaceholder')} multiline numberOfLines={3} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={t('common.add')} variant="primary" onPress={submit} style={{ flex: 1 }} />
            <Button label={t('common.cancel')} variant="text" onPress={() => setAdding(false)} style={{ flex: 1 }} />
          </View>
        </Surface>
      )}
      {items.length === 0 && !adding && <EmptyState icon={ICONS.inbox} title={t('record.inboxEmpty')} />}
      {items.map((it) => (
        <ListRow
          key={it.id}
          left={
            <TouchableOpacity
              onPress={() => onToggle(it)}
              accessibilityRole="button"
              accessibilityLabel={it.done ? t('record.restore') : t('record.complete')}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: it.done ? theme.primaryContainer : theme.surfaceContainer,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon
                name={it.done ? ICONS.check : 'checkbox-blank-circle-outline'}
                size={22}
                color={it.done ? theme.onPrimaryContainer : theme.onSurfaceVariant}
              />
            </TouchableOpacity>
          }
          title={
            <M3Text role="bodyLarge" style={it.done ? { textDecorationLine: 'line-through', color: theme.onSurfaceVariant } : undefined}>
              {it.text}
            </M3Text>
          }
          right={it.done ? <Chip label={t('record.done')} selected /> : null}
        />
      ))}
    </>
  );
}

function MediaSub({
  items,
  adding,
  setAdding,
  theme,
}: {
  items: MediaItem[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  theme: any;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<MediaType>('book');
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [status, setStatus] = useState<MediaStatus>('want');
  const [review, setReview] = useState('');
  const submit = async () => {
    if (!title.trim()) return;
    const list = await store.getMedia();
    await store.setMedia([
      { id: uid('m'), type, title: title.trim(), creator: creator.trim(), status, rating: 0, review: review.trim(), createdAt: Date.now() },
      ...list,
    ]);
    setTitle('');
    setCreator('');
    setReview('');
    setType('book');
    setStatus('want');
    setAdding(false);
  };
  return (
    <>
      {adding && (
        <Surface level={1} style={{ padding: 16, marginBottom: cardGap, borderRadius: radius.card }}>
          <M3Text role="titleMedium" style={{ marginBottom: 12 }}>
            {t('record.addMedia')}
          </M3Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {(['book', 'movie', 'music'] as const).map((ty) => (
              <Chip key={ty} label={ty === 'book' ? t('record.mediaBook') : ty === 'movie' ? t('record.mediaMovie') : t('record.mediaMusic')} selected={type === ty} onPress={() => setType(ty)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('record.titleLabel2')} value={title} onChangeText={setTitle} placeholder={t('record.mediaTitlePlaceholder')} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={t('record.creatorLabel')} value={creator} onChangeText={setCreator} placeholder={t('record.opt')} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {(['want', 'doing', 'done'] as const).map((s) => (
              <Chip key={s} label={s === 'want' ? t('record.statusWant') : s === 'doing' ? t('record.statusDoing') : t('record.statusDone')} selected={status === s} onPress={() => setStatus(s)} />
            ))}
          </View>
          <View style={{ marginBottom: 14 }}>
            <TextField label={t('record.reviewLabel')} value={review} onChangeText={setReview} placeholder={t('record.reviewPlaceholder')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={t('common.add')} variant="primary" onPress={submit} style={{ flex: 1 }} />
            <Button label={t('common.cancel')} variant="text" onPress={() => setAdding(false)} style={{ flex: 1 }} />
          </View>
        </Surface>
      )}
      {items.length === 0 && !adding && <EmptyState icon={ICONS.media} title={t('record.mediaEmpty')} />}
      {items.map((m) => {
        const statusLabel = m.status === 'done' ? t('record.statusDone') : m.status === 'doing' ? t('record.statusDoing') : t('record.statusWant');
        return (
          <ListRow
            key={m.id}
            left={
              <IconTile bg={theme.primaryContainer} color={theme.onPrimaryContainer}>
                <Icon
                  name={m.type === 'book' ? ICONS.journal : m.type === 'movie' ? ICONS.media : 'music-note'}
                  size={18}
                  color={theme.onPrimaryContainer}
                />
              </IconTile>
            }
            title={m.title}
            subtitle={`${m.creator ? m.creator + ' · ' : ''}${statusLabel}${m.review ? ' · ' + m.review : ''}`}
          />
        );
      })}
    </>
  );
}
