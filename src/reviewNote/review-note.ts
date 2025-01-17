import { Notice, TFile } from "obsidian";
import { DataStore } from "src/dataStore/data";
import { DataLocation } from "src/dataStore/dataLocation";
import { ItemToDecks } from "src/dataStore/itemToDecks";
import { reviewResponseModal } from "src/gui/reviewresponse-modal";
import { t } from "src/lang/helpers";
import { ReviewDeck } from "src/ReviewDeck";
import { SRSettings } from "src/settings";
import { Tags } from "src/tags";
import { DateUtils, isIgnoredPath } from "src/util/utils_recall";

export class ReviewNote {
    static itemId: number;
    static minNextView: number;

    settings: SRSettings;

    static create(settings: SRSettings, location: DataLocation) {
        return new ReviewNote(settings);
    }

    constructor(settings: SRSettings) {
        this.settings = settings;
    }

    /**
     * 231215-not used yet.
     * after checking ignored folder, get note deckname from review tag and trackedfile.
     * @param settings SRSettings
     * @param note TFile
     * @returns string | null
     */
    static getDeckName(settings: SRSettings, note: TFile): string | null {
        const store = DataStore.getInstance();
        // const settings = plugin.data.settings;

        if (isIgnoredPath(settings.noteFoldersToIgnore, note.path)) {
            new Notice(t("NOTE_IN_IGNORED_FOLDER"));
            return;
        }

        let deckName = Tags.getNoteDeckName(note, settings);

        if (
            (settings.untrackWithReviewTag && deckName == null) ||
            (!settings.untrackWithReviewTag &&
                deckName == null &&
                !store.getTrackedFile(note.path)?.isTrackedNote)
        ) {
            new Notice(t("PLEASE_TAG_NOTE"));
            return;
        }
        if (deckName == null) {
            deckName = store.getTrackedFile(note.path)?.lastTag ?? null;
        }
        return deckName;
    }

    static saveReviewResponse_trackfiles(
        note: TFile,
        option: string,
        burySiblingCards: boolean,
        ease?: number,
    ) {
        const store = DataStore.getInstance();
        const now = Date.now();

        const itemId = store.getTrackedFile(note.path).noteID;
        const item = store.getItembyID(itemId);
        if (item.isNew && ease != null) {
            // new note
            item.updateAlgorithmData("ease", ease);
        }
        const buryList: string[] = [];
        if (burySiblingCards) {
            const trackFile = store.getTrackedFile(note.path);
            if (trackFile.hasCards) {
                for (const cardinfo of trackFile.cardItems) {
                    buryList.push(cardinfo.cardTextHash);
                }
            }
        }

        ReviewNote.recallReviewResponse(itemId, option);

        // preUpdateDeck(deck, note);
        // ItemToDecks.toRevDeck(deck, note, now);
        return {
            buryList,
            sNote: {
                note,
                item,
                dueUnix: item.nextReview,
                interval: item.interval,
                ease: item.ease,
            },
        };
    }

    static recallReviewNote(settings: SRSettings) {
        // const plugin = this.plugin;
        const store = DataStore.getInstance();
        const reviewFloatBar = reviewResponseModal.getInstance();
        // const settings = plugin.data.settings;
        const que = store.data.queues;
        que.buildQueue();
        const item = store.getNext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state: any = { mode: "empty" };
        if (item != null && item.isTracked) {
            this.itemId = item.ID;
            console.debug("item:", item, que.queueSize());
            const path = store.getFilePath(item);
            if (path != null) {
                state.file = path;
                state.item = que.getNextId();
                // state.mode = "question";

                reviewFloatBar.display(item, (opt) => {
                    this.recallReviewResponse(this.itemId, opt);
                    if (settings.autoNextNote) {
                        this.recallReviewNote(settings);
                    }
                });
            }
        }
        const leaf = app.workspace.getLeaf();
        leaf.setViewState({
            type: "markdown",
            state: state,
        });

        app.workspace.setActiveLeaf(leaf);

        if (item != null) {
            const newstate = leaf.getViewState();
            console.debug(newstate);
            return;
        }

        this.nextReviewNotice(store.data.queues.toDayLatterQueue);

        // plugin.updateStatusBar();

        reviewFloatBar.selfDestruct();
        new Notice(t("ALL_CAUGHT_UP"));
    }

    static recallReviewResponse(itemId: number, response: string) {
        const store = DataStore.getInstance();
        const item = store.getItembyID(itemId);
        // console.debug("itemId: ", itemId);
        store.updateReviewedCounts(itemId);
        store.reviewId(itemId, response);
        store.save();
        this.minNextView = this.updateminNextView(this.minNextView, item.nextReview);
    }

    static getDeckNameForReviewDirectly(reviewDecks: {
        [deckKey: string]: ReviewDeck;
    }): string | null {
        const reviewDeckNames: string[] = Object.keys(reviewDecks);
        const rdnames: string[] = [];
        reviewDeckNames.some((dkey: string) => {
            const ndeck = reviewDecks[dkey];
            const ncount = ndeck.dueNotesCount;
            if (ncount > 0) {
                rdnames.push(dkey);
            }
        });
        reviewDeckNames.some((dkey: string) => {
            const ndeck = reviewDecks[dkey];
            const ncount = ndeck.newNotes.length;
            if (ncount > 0) {
                rdnames.push(dkey);
            }
        });
        if (rdnames.length > 0) {
            const ind = Math.floor(Math.random() * rdnames.length);
            return rdnames[ind];
        } else {
            return null;
        }
    }

    static getNextDueNoteIndex(NotesCount: number, openRandomNote: boolean = false) {
        let index = -1;

        if (NotesCount < 1) {
            return -1;
        }
        if (!openRandomNote) {
            return 0;
        } else {
            index = Math.floor(Math.random() * NotesCount);
        }
        return index;
    }

    static updateminNextView(minNextView: number, nextReview: number): number {
        const now = Date.now();
        const nowToday: number = DateUtils.EndofToday;

        if (nextReview <= nowToday) {
            if (minNextView == undefined || minNextView < now || minNextView > nextReview) {
                // console.debug("interval diff:should be - (", minNextView - nextReview);
                minNextView = nextReview;
            }
        }
        return minNextView;
    }

    static nextReviewNotice(toDayLatterQueue: Record<number, string>) {
        if (this.minNextView > 0 && Object.keys(toDayLatterQueue).length > 0) {
            const now = Date.now();
            const interval = Math.round((this.minNextView - now) / 1000 / 60);
            if (interval < 60) {
                new Notice("可以在" + interval + "分钟后来复习");
            } else if (interval < 60 * 5) {
                new Notice("可以在" + interval / 60 + "小时后来复习");
            }
        }
    }
}

function preUpdateDeck(deck: ReviewDeck, note: TFile) {
    const newindex = deck.newNotes.findIndex((sNote, _index) => {
        return sNote.note === note;
    });
    if (newindex >= 0) {
        // isNew
        deck.newNotes.splice(newindex, 1);
    } else {
        //isDued
        const index = deck.scheduledNotes.findIndex((sNote, _index) => {
            return sNote.note === note;
        });
        deck.scheduledNotes.splice(index, 1);
        if (index < deck.dueNotesCount) {
            deck.dueNotesCount--;
        }
    }
    return;
}

export function updatenDays(dueDates: Record<number, number>, dueUnix: number) {
    const nDays: number = Math.ceil((dueUnix - DateUtils.EndofToday) / DateUtils.DAYS_TO_MILLIS);
    if (!Object.prototype.hasOwnProperty.call(dueDates, nDays)) {
        dueDates[nDays] = 0;
    }
    dueDates[nDays]++;
}
