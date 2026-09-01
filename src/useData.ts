import { useEffect, useState } from 'react';
import { store, onChange, ensureMigrated } from './store';
import type { Txn, Budget, Habit, Task, ShopItem, MediaItem, JournalEntry, InboxItem, Account, FxSetting } from './types';

export interface AllData {
  txns: Txn[];
  budgets: Budget[];
  habits: Habit[];
  tasks: Task[];
  shopping: ShopItem[];
  media: MediaItem[];
  journal: JournalEntry[];
  inbox: InboxItem[];
  cardDays: { stmt: number | null; due: number | null };
  fxRate: number;
  accounts: Account[];
  fx: FxSetting;
}

const EMPTY: AllData = {
  txns: [],
  budgets: [],
  habits: [],
  tasks: [],
  shopping: [],
  media: [],
  journal: [],
  inbox: [],
  cardDays: { stmt: null, due: null },
  fxRate: 1.65,
  accounts: [],
  fx: { base: 'MYR', cnyPerMyr: 1.65, rateScaled: 1650000, rateUpdatedAt: 0, rateSource: 'system' },
};

export function useData(): AllData {
  const [d, setD] = useState<AllData>(EMPTY);
  useEffect(() => {
    let alive = true;
    const reloadAll = async () => {
      await ensureMigrated(); // backup-first, idempotent — runs once per launch
      const [txns, budgets, habits, tasks, shopping, media, journal, inbox, cardDays, fxRate, accounts, fx] = await Promise.all([
        store.getTxns(),
        store.getBudgets(),
        store.getHabits(),
        store.getTasks(),
        store.getShopping(),
        store.getMedia(),
        store.getJournal(),
        store.getInbox(),
        store.getCardDays(),
        store.getFxRate(),
        store.getAccounts(),
        store.getFx(),
      ]);
      if (alive) setD({ txns, budgets, habits, tasks, shopping, media, journal, inbox, cardDays, fxRate, accounts, fx });
    };

    // A write now publishes its storage key. Refresh only that domain instead
    // of parsing all twelve JSON blobs on every checkbox or transaction edit.
    const reloadKey = async (key?: string) => {
      if (!key) return reloadAll();
      switch (key) {
        case 'wb_life_txns': {
          const txns = await store.getTxns();
          if (alive) setD((prev) => ({ ...prev, txns }));
          break;
        }
        case 'wb_life_budgets': {
          const budgets = await store.getBudgets();
          if (alive) setD((prev) => ({ ...prev, budgets }));
          break;
        }
        case 'wb_life_habits': {
          const habits = await store.getHabits();
          if (alive) setD((prev) => ({ ...prev, habits }));
          break;
        }
        case 'wb_life_schedule': {
          const tasks = await store.getTasks();
          if (alive) setD((prev) => ({ ...prev, tasks }));
          break;
        }
        case 'wb_life_shopping': {
          const shopping = await store.getShopping();
          if (alive) setD((prev) => ({ ...prev, shopping }));
          break;
        }
        case 'wb_life_media': {
          const media = await store.getMedia();
          if (alive) setD((prev) => ({ ...prev, media }));
          break;
        }
        case 'wb_life_journal': {
          const journal = await store.getJournal();
          if (alive) setD((prev) => ({ ...prev, journal }));
          break;
        }
        case 'wb_life_inbox': {
          const inbox = await store.getInbox();
          if (alive) setD((prev) => ({ ...prev, inbox }));
          break;
        }
        case 'wb_life_card_stmt_day':
        case 'wb_life_card_due_day': {
          const cardDays = await store.getCardDays();
          if (alive) setD((prev) => ({ ...prev, cardDays }));
          break;
        }
        case 'wb_life_fx_rate': {
          const fxRate = await store.getFxRate();
          if (alive) setD((prev) => ({ ...prev, fxRate }));
          break;
        }
        case 'wb_life_accounts': {
          const accounts = await store.getAccounts();
          if (alive) setD((prev) => ({ ...prev, accounts }));
          break;
        }
        case 'wb_life_fx': {
          const fx = await store.getFx();
          if (alive) setD((prev) => ({ ...prev, fx }));
          break;
        }
        default:
          // Theme, cloud configuration and importer audit keys do not affect AllData.
          break;
      }
    };

    reloadAll();
    const off = onChange(reloadKey);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return d;
}
